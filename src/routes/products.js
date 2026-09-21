const router = require('express').Router();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const pool = require('../config/db');
const { authRequired, authOptional, requireVendor } = require('../middleware/auth');
const { HttpError, wrap } = require('../utils/http');
const { matchCategory, titleCase } = require('../utils/category-match');

// --- product image uploads (files on disk, path in the database) ---
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'products');
const MAX_IMAGES = 5;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.jpg').toLowerCase().slice(0, 8);
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) return cb(new HttpError(400, 'Only JPG, PNG, WEBP, GIF or AVIF images are allowed.'));
    cb(null, true);
  },
});

const uploadImages = upload.array('images', MAX_IMAGES);

function cleanupFiles(files) {
  for (const f of files || []) fs.promises.unlink(f.path).catch(() => {});
}

async function withProductDetails(products) {
  if (!products.length) return products;
  const ids = products.map((product) => product.product_id);
  const placeholders = ids.map(() => '?').join(',');
  const [images, specifications] = await Promise.all([
    pool.query(`SELECT product_id, img_id, image_url, is_primary, sort_order
                FROM product_image WHERE product_id IN (${placeholders})
                ORDER BY is_primary DESC, sort_order ASC, img_id ASC`, ids),
    pool.query(`SELECT product_id, product_specification_id, title, spec
                FROM product_specification WHERE product_id IN (${placeholders})
                ORDER BY product_specification_id ASC`, ids),
  ]);
  const imagesByProduct = new Map();
  const specificationsByProduct = new Map();
  images[0].forEach((image) => {
    const current = imagesByProduct.get(image.product_id) || [];
    current.push(image);
    imagesByProduct.set(image.product_id, current);
  });
  specifications[0].forEach((specification) => {
    const current = specificationsByProduct.get(specification.product_id) || [];
    current.push(specification);
    specificationsByProduct.set(specification.product_id, current);
  });
  return products.map((product) => ({
    ...product,
    images: imagesByProduct.get(product.product_id) || [],
    specifications: specificationsByProduct.get(product.product_id) || [],
  }));
}

function detailInput(body) {
  const images = Array.isArray(body.images)
    ? body.images.map((image) => String(image || '').trim()).filter(Boolean)
    : [];
  if (images.length > 5) {
    throw new HttpError(400, 'A product can have at most 5 images.');
  }
  const specifications = Array.isArray(body.specifications)
    ? body.specifications
      .map(({ title, spec }) => ({ title: String(title || '').trim(), spec: String(spec || '').trim() }))
      .filter((item) => item.title && item.spec).slice(0, 12)
    : [];
  return { images, specifications };
}

/**
 * Qty/unit is free text, e.g. '2kg', '3 nos', '400 gram'. Numbers are still
 * accepted ('2' → '2'). Empty becomes NULL; over 50 chars is rejected.
 */
function quantityText(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const text = String(value).trim();
  if (text.length > 50) throw new HttpError(400, 'Qty/unit must be 50 characters or less (e.g. "2kg", "3 nos").');
  return text;
}

async function replaceProductDetails(productId, details, userId) {
  await pool.query('DELETE FROM product_image WHERE product_id = ?', [productId]);
  await pool.query('DELETE FROM product_specification WHERE product_id = ?', [productId]);
  for (const [index, imageUrl] of details.images.entries()) {
    await pool.query(
      'INSERT INTO product_image (product_id, image_url, is_primary, sort_order, created_by) VALUES (?, ?, ?, ?, ?)',
      [productId, imageUrl, index === 0 ? 1 : 0, index, userId]
    );
  }
  for (const specification of details.specifications) {
    await pool.query(
      'INSERT INTO product_specification (product_id, title, spec, created_by) VALUES (?, ?, ?, ?)',
      [productId, specification.title, specification.spec, userId]
    );
  }
}

/**
 * Client visibility: a user may browse only the products of vendors they are a
 * verified client of (vendor_client pairs → user.vendor_ids). A vendor's own
 * products stay in Profile → My Products. Anonymous visitors get an empty list.
 */
function clientVisibleSql(vendorIds) {
  if (!vendorIds || !vendorIds.length) return 'AND 0';
  return 'AND p.vendor_id IN (' + vendorIds.map(() => '?').join(',') + ')';
}

// GET /api/products — product browsing restricted to the caller's vendor.
// Query: ?category_id=&q=.
router.get('/', authOptional, wrap(async (req, res) => {
  const categoryId = req.query.category_id ? Number(req.query.category_id) : null;
  const q = req.query.q ? `%${req.query.q}%` : null;
  const vendorIds = req.user?.vendor_ids || [];
  const [rows] = await pool.query(
    `SELECT p.product_id, p.vendor_id, p.category_id, p.product, p.description,
            p.quantity, p.selling_price, p.stock_quantity, p.date,
            c.category AS category_name, u.name AS vendor_name
     FROM product p
     JOIN category c ON c.category_id = p.category_id
     JOIN user u ON u.user_id = p.vendor_id
     WHERE (? IS NULL OR p.category_id = ?)
       AND (? IS NULL OR p.product LIKE ?)
       ${clientVisibleSql(vendorIds)}
     ORDER BY p.created_at DESC`,
    [categoryId, categoryId, q, q, ...vendorIds]
  );
  res.json({ success: true, data: await withProductDetails(rows) });
}));

// GET /api/products/:id — public product details, including images and specifications
// GET /api/products/:id — product details, including images and specifications.
// Visible only to the selling vendor's client (same rule as the list).
router.get('/:id(\\d+)', authOptional, wrap(async (req, res) => {
  const vendorIds = req.user?.vendor_ids || [];
  const [rows] = await pool.query(
    `SELECT p.product_id, p.vendor_id, p.category_id, p.product, p.description,
            p.quantity, p.selling_price, p.stock_quantity, p.date,
            c.category AS category_name, u.name AS vendor_name
     FROM product p
     JOIN category c ON c.category_id = p.category_id
     JOIN user u ON u.user_id = p.vendor_id
     WHERE p.product_id = ? ${clientVisibleSql(vendorIds)}`,
    [req.params.id, ...vendorIds]
  );
  if (!rows.length) throw new HttpError(404, 'Product not found.');
  res.json({ success: true, data: (await withProductDetails(rows))[0] });
}));

router.use(authRequired);

async function requireOwnedProduct(productId, userId) {
  const [rows] = await pool.query(
    'SELECT product_id FROM product WHERE product_id = ? AND vendor_id = ?',
    [productId, userId]
  );
  if (!rows.length) throw new HttpError(404, 'Product not found or you do not own it.');
}

// Dedicated media/specification APIs for vendor product-management screens.
router.get('/:id/images', requireVendor, wrap(async (req, res) => {
  await requireOwnedProduct(req.params.id, req.user.user_id);
  const [rows] = await pool.query(
    'SELECT img_id, product_id, image_url, is_primary, sort_order FROM product_image WHERE product_id = ? ORDER BY is_primary DESC, sort_order, img_id',
    [req.params.id]
  );
  res.json({ success: true, data: rows });
}));

// POST /api/products/:id/images/upload — multipart upload of up to 5 image
// files per product. Files are stored in public/uploads/products; the served
// path is stored in product_image.
router.post('/:id/images/upload', requireVendor, (req, res) => {
  uploadImages(req, res, async (err) => {
    if (err) {
      cleanupFiles(req.files);
      const status = err instanceof HttpError ? err.status : (err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_UNEXPECTED_FILE' ? 400 : 500);
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'Each image must be 5 MB or smaller.' : err.code === 'LIMIT_UNEXPECTED_FILE' ? `Up to ${MAX_IMAGES} images per product.` : (err instanceof HttpError ? err.message : 'Image upload failed.');
      return res.status(status).json({ success: false, message });
    }
    try {
      await requireOwnedProduct(req.params.id, req.user.user_id);
      const files = req.files || [];
      const [[{ existing }]] = await pool.query('SELECT COUNT(*) AS existing FROM product_image WHERE product_id = ?', [req.params.id]);
      if (existing + files.length > MAX_IMAGES) {
        cleanupFiles(files);
        return res.status(400).json({ success: false, message: `A product can have at most ${MAX_IMAGES} images (${existing} already uploaded).` });
      }
      if (!files.length) return res.status(400).json({ success: false, message: 'No image files received (field name must be "images").' });
      const saved = [];
      for (const [index, file] of files.entries()) {
        const imageUrl = `/uploads/products/${file.filename}`;
        const [result] = await pool.query(
          'INSERT INTO product_image (product_id, image_url, is_primary, sort_order, created_by) VALUES (?, ?, ?, ?, ?)',
          [req.params.id, imageUrl, existing === 0 && index === 0 ? 1 : 0, existing + index, req.user.user_id]
        );
        const [rows] = await pool.query('SELECT img_id, product_id, image_url, is_primary, sort_order FROM product_image WHERE img_id = ?', [result.insertId]);
        saved.push(rows[0]);
      }
      res.status(201).json({ success: true, data: saved });
    } catch (dbErr) {
      cleanupFiles(req.files);
      throw dbErr;
    }
  });
});

// POST /api/products/create-with-assets — multipart one-shot product creation.
// Fields: product, description, new_category | category_id, quantity,
// selling_price, stock_quantity, specifications (JSON array of {title, spec}).
// Files: images[] (up to MAX_IMAGES). The product row, image rows (file saved
// to public/uploads/products, served path stored in product_image) and all
// specification rows are written in ONE transaction; uploaded files are
// cleaned up if anything fails.
router.post('/create-with-assets', requireVendor, (req, res) => {
  uploadImages(req, res, async (err) => {
    if (err) {
      cleanupFiles(req.files);
      const status = err instanceof HttpError ? err.status : (err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_UNEXPECTED_FILE' ? 400 : 500);
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'Each image must be 5 MB or smaller.' : err.code === 'LIMIT_UNEXPECTED_FILE' ? `Up to ${MAX_IMAGES} images per product.` : (err instanceof HttpError ? err.message : 'Product creation failed.');
      return res.status(status).json({ success: false, message });
    }
    const files = req.files || [];
    const conn = await pool.getConnection();
    try {
      const body = req.body || {};
      const productName = String(body.product || '').trim();
      if (!productName) throw new HttpError(400, 'Product name is required.');
      const sellingPrice = Number(body.selling_price);
      if (Number.isNaN(sellingPrice) || sellingPrice < 0) throw new HttpError(400, 'Selling price must be 0 or more.');
      const stockQuantity = Number(body.stock_quantity || 0);
      if (Number.isNaN(stockQuantity) || stockQuantity < 0) throw new HttpError(400, 'Stock quantity must be 0 or more.');
      const [[{ cnt }]] = await conn.query('SELECT COUNT(*) AS cnt FROM product WHERE vendor_id = ?', [req.user.user_id]);
      if (req.user.number_of_products != null && cnt >= req.user.number_of_products) {
        throw new HttpError(403, `Plan limit reached: your ${req.user.plan} plan allows up to ${req.user.number_of_products} products. Upgrade to add more.`);
      }
      // Same fuzzy resolve-or-create rule as the JSON route: a typed name that
      // resembles an existing category joins it instead of duplicating it.
      let categoryId = Number(body.category_id) || null;
      let categoryName = null;
      if (!categoryId) {
        const typed = String(body.new_category || '').trim();
        if (!typed) throw new HttpError(400, 'Please select or type a category.');
        const [all] = await conn.query('SELECT category_id, category FROM category');
        const hit = matchCategory(typed, all);
        if (hit) { categoryId = hit.category_id; categoryName = hit.category; }
        else {
          const [created] = await conn.query('INSERT INTO category (category, created_by) VALUES (?, ?)', [titleCase(typed), req.user.user_id]);
          categoryId = created.insertId;
          categoryName = titleCase(typed);
        }
      } else {
        const [cats] = await conn.query('SELECT category_id FROM category WHERE category_id = ?', [categoryId]);
        if (!cats.length) throw new HttpError(400, 'Selected category does not exist.');
      }
      let specs = [];
      if (body.specifications) {
        try { specs = JSON.parse(body.specifications); } catch { throw new HttpError(400, 'Invalid specifications payload.'); }
        if (!Array.isArray(specs)) throw new HttpError(400, 'Invalid specifications payload.');
        specs = specs
          .map((sp) => ({ title: String((sp && sp.title) || '').trim(), spec: String((sp && sp.spec) || '').trim() }))
          .filter((sp) => sp.title && sp.spec);
      }
      if (files.length > MAX_IMAGES) throw new HttpError(400, `Up to ${MAX_IMAGES} images per product.`);
      await conn.beginTransaction();
      const [result] = await conn.query(
        `INSERT INTO product (vendor_id, category_id, product, description, quantity, selling_price, date, stock_quantity, created_by)
         VALUES (?, ?, ?, ?, ?, ?, CURDATE(), ?, ?)`,
        [req.user.user_id, categoryId, productName, body.description || null, quantityText(body.quantity), sellingPrice, stockQuantity, req.user.user_id]
      );
      const productId = result.insertId;
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        await conn.query(
          'INSERT INTO product_image (product_id, image_url, is_primary, sort_order, created_by) VALUES (?, ?, ?, ?, ?)',
          [productId, '/uploads/products/' + f.filename, i === 0 ? 1 : 0, i, req.user.user_id]
        );
      }
      for (const sp of specs) {
        await conn.query(
          'INSERT INTO product_specification (product_id, title, spec, created_by) VALUES (?, ?, ?, ?)',
          [productId, sp.title, sp.spec, req.user.user_id]
        );
      }
      await conn.commit();
      conn.release();
      const [rows] = await pool.query('SELECT * FROM product WHERE product_id = ?', [productId]);
      res.status(201).json({ success: true, data: { ...rows[0], category_name: categoryName, images_written: files.length, specifications_written: specs.length } });
    } catch (err2) {
      await conn.rollback().catch(() => {});
      conn.release();
      cleanupFiles(files);
      const status = err2 instanceof HttpError ? err2.status : 500;
      res.status(status).json({ success: false, message: err2.message || 'Product creation failed.' });
    }
  });
});
router.post('/:id/images', requireVendor, wrap(async (req, res) => {
  const { image_url, is_primary, sort_order } = req.body || {};
  if (!image_url || !String(image_url).trim()) throw new HttpError(400, 'Image URL is required.');
  await requireOwnedProduct(req.params.id, req.user.user_id);
  if (is_primary) await pool.query('UPDATE product_image SET is_primary = 0 WHERE product_id = ?', [req.params.id]);
  const [result] = await pool.query(
    'INSERT INTO product_image (product_id, image_url, is_primary, sort_order, created_by) VALUES (?, ?, ?, ?, ?)',
    [req.params.id, String(image_url).trim(), is_primary ? 1 : 0, Number(sort_order || 0), req.user.user_id]
  );
  const [rows] = await pool.query('SELECT * FROM product_image WHERE img_id = ?', [result.insertId]);
  res.status(201).json({ success: true, data: rows[0] });
}));

router.delete('/:id/images/:imageId', requireVendor, wrap(async (req, res) => {
  await requireOwnedProduct(req.params.id, req.user.user_id);
  const [rows] = await pool.query('SELECT img_id, image_url FROM product_image WHERE img_id = ? AND product_id = ?', [req.params.imageId, req.params.id]);
  if (!rows.length) throw new HttpError(404, 'Image not found.');
  await pool.query('DELETE FROM product_image WHERE img_id = ?', [req.params.imageId]);
  // Uploaded files live under /uploads/products — remove the file from disk too.
  const url = rows[0].image_url || '';
  if (url.startsWith('/uploads/products/')) {
    const safeName = path.basename(url);
    fs.promises.unlink(path.join(UPLOAD_DIR, safeName)).catch(() => {});
  }
  res.json({ success: true, data: { deleted: true } });
}));

router.get('/:id/specifications', requireVendor, wrap(async (req, res) => {
  await requireOwnedProduct(req.params.id, req.user.user_id);
  const [rows] = await pool.query('SELECT product_specification_id, product_id, title, spec FROM product_specification WHERE product_id = ? ORDER BY product_specification_id', [req.params.id]);
  res.json({ success: true, data: rows });
}));

router.post('/:id/specifications', requireVendor, wrap(async (req, res) => {
  const { title, spec } = req.body || {};
  if (!title || !spec) throw new HttpError(400, 'Specification title and value are required.');
  await requireOwnedProduct(req.params.id, req.user.user_id);
  const [result] = await pool.query(
    'INSERT INTO product_specification (product_id, title, spec, created_by) VALUES (?, ?, ?, ?)',
    [req.params.id, String(title).trim(), String(spec).trim(), req.user.user_id]
  );
  const [rows] = await pool.query('SELECT * FROM product_specification WHERE product_specification_id = ?', [result.insertId]);
  res.status(201).json({ success: true, data: rows[0] });
}));

router.put('/:id/specifications/:specificationId', requireVendor, wrap(async (req, res) => {
  const { title, spec } = req.body || {};
  if (!title || !spec) throw new HttpError(400, 'Specification title and value are required.');
  await requireOwnedProduct(req.params.id, req.user.user_id);
  const [result] = await pool.query(
    'UPDATE product_specification SET title = ?, spec = ?, updated_by = ? WHERE product_specification_id = ? AND product_id = ?',
    [String(title).trim(), String(spec).trim(), req.user.user_id, req.params.specificationId, req.params.id]
  );
  if (!result.affectedRows) throw new HttpError(404, 'Specification not found.');
  res.json({ success: true, data: { product_specification_id: Number(req.params.specificationId), title: String(title).trim(), spec: String(spec).trim() } });
}));

router.delete('/:id/specifications/:specificationId', requireVendor, wrap(async (req, res) => {
  await requireOwnedProduct(req.params.id, req.user.user_id);
  const [result] = await pool.query('DELETE FROM product_specification WHERE product_specification_id = ? AND product_id = ?', [req.params.specificationId, req.params.id]);
  if (!result.affectedRows) throw new HttpError(404, 'Specification not found.');
  res.json({ success: true, data: { deleted: true } });
}));

// GET /api/products/mine — vendor's own products
router.get('/mine', requireVendor, wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.product_id, p.vendor_id, p.category_id, p.product, p.description,
            p.quantity, p.selling_price, p.stock_quantity, p.date,
            c.category AS category_name,
            CAST(COALESCE(oi.ordered_qty, 0) AS UNSIGNED) AS ordered_quantity
     FROM product p
     JOIN category c ON c.category_id = p.category_id
     LEFT JOIN (
       SELECT oi.product_id, SUM(oi.quantity) AS ordered_qty
       FROM order_item oi
       JOIN \`order\` o ON o.order_id = oi.order_id
       WHERE o.vendor_id = ? AND o.status IN ('confirmed', 'shipped', 'out_for_delivery', 'completed')
       GROUP BY oi.product_id
     ) oi ON oi.product_id = p.product_id
     WHERE p.vendor_id = ?
     ORDER BY p.created_at DESC`,
    [req.user.user_id, req.user.user_id]
  );
  res.json({ success: true, data: await withProductDetails(rows) });
}));

// POST /api/products — vendor only, respects number_of_products plan limit
router.post('/', requireVendor, wrap(async (req, res) => {
  const { product, description, category_id, new_category, quantity, selling_price, stock_quantity } = req.body || {};
  const details = detailInput(req.body || {});
  if (!product || !String(product).trim()) throw new HttpError(400, 'Product name is required.');
  if (!category_id && !(new_category && String(new_category).trim())) throw new HttpError(400, 'Please select or type a category.');
  if (selling_price === undefined || Number(selling_price) < 0) {
    throw new HttpError(400, 'Selling price must be 0 or more.');
  }
  // Category: an explicit category_id wins; otherwise resolve the typed name
  // against existing categories first (fuzzy) so variants like
  // "vegitable fruits and strawberry" reuse "Fruits & Vegetables" instead of
  // creating a near-duplicate row. Only a genuine miss creates a new category.
  let resolvedCategoryId = Number(category_id) || null;
  let resolvedCategoryName = null;
  if (!resolvedCategoryId) {
    const typed = String(new_category).trim();
    const [all] = await pool.query('SELECT category_id, category FROM category');
    const hit = matchCategory(typed, all);
    if (hit) {
      resolvedCategoryId = hit.category_id;
      resolvedCategoryName = hit.category;
    } else {
      const [created] = await pool.query(
        'INSERT INTO category (category, created_by) VALUES (?, ?)',
        [titleCase(typed), req.user.user_id]
      );
      resolvedCategoryId = created.insertId;
      resolvedCategoryName = titleCase(typed);
    }
  } else {
    const [cats] = await pool.query('SELECT category_id FROM category WHERE category_id = ?', [resolvedCategoryId]);
    if (!cats.length) throw new HttpError(400, 'Selected category does not exist.');
  }

  const [[{ cnt }]] = await pool.query(
    'SELECT COUNT(*) AS cnt FROM product WHERE vendor_id = ?',
    [req.user.user_id]
  );
  if (req.user.number_of_products != null && cnt >= req.user.number_of_products) {
    throw new HttpError(
      403,
      `Plan limit reached: your ${req.user.plan} plan allows up to ${req.user.number_of_products} products. Upgrade to add more.`
    );
  }

  const [result] = await pool.query(
    `INSERT INTO product (vendor_id, category_id, product, description, quantity, selling_price, date, stock_quantity, created_by)
     VALUES (?, ?, ?, ?, ?, ?, CURDATE(), ?, ?)`,
    [
      req.user.user_id,
      resolvedCategoryId,
      String(product).trim(),
      description || null,
      quantityText(quantity),
      Number(selling_price),
      Number(stock_quantity || 0),
      req.user.user_id,
    ]
  );
  const [rows] = await pool.query(
    `SELECT p.*, c.category AS category_name
     FROM product p JOIN category c ON c.category_id = p.category_id
     WHERE p.product_id = ?`,
    [result.insertId]
  );
  await replaceProductDetails(result.insertId, details, req.user.user_id);
  res.status(201).json({ success: true, data: (await withProductDetails(rows))[0] });
}));

// PUT /api/products/:id — vendor can only edit their own products
router.put('/:id', requireVendor, wrap(async (req, res) => {
  const { product, description, category_id, quantity, selling_price, stock_quantity } = req.body || {};
  const details = detailInput(req.body || {});
  if (!product || !String(product).trim()) throw new HttpError(400, 'Product name is required.');
  if (!category_id) throw new HttpError(400, 'Please select a category.');
  if (selling_price === undefined || Number(selling_price) < 0) {
    throw new HttpError(400, 'Selling price must be 0 or more.');
  }
  const [cats] = await pool.query('SELECT category_id FROM category WHERE category_id = ?', [category_id]);
  if (!cats.length) throw new HttpError(400, 'Selected category does not exist.');

  const [result] = await pool.query(
    `UPDATE product
     SET product = ?, description = ?, category_id = ?, quantity = ?, selling_price = ?, stock_quantity = ?, updated_by = ?
     WHERE product_id = ? AND vendor_id = ?`,
    [
      String(product).trim(),
      description || null,
      Number(category_id),
      quantityText(quantity),
      Number(selling_price),
      Number(stock_quantity || 0),
      req.user.user_id,
      req.params.id,
      req.user.user_id,
    ]
  );
  if (!result.affectedRows) throw new HttpError(404, 'Product not found or you do not own it.');
  if (Array.isArray(req.body.images) || Array.isArray(req.body.specifications)) {
    await replaceProductDetails(req.params.id, details, req.user.user_id);
  }
  const [rows] = await pool.query(
    `SELECT p.*, c.category AS category_name
     FROM product p JOIN category c ON c.category_id = p.category_id
     WHERE p.product_id = ?`,
    [req.params.id]
  );
  res.json({ success: true, data: (await withProductDetails(rows))[0] });
}));

// DELETE /api/products/:id — vendor can only delete their own products
router.delete('/:id', requireVendor, wrap(async (req, res) => {
  const [owned] = await pool.query('SELECT product_id FROM product WHERE product_id = ? AND vendor_id = ?', [req.params.id, req.user.user_id]);
  if (!owned.length) throw new HttpError(404, 'Product not found or you do not own it.');
  // Collect uploaded file paths before the delete cascades the rows away.
  const [imageRows] = await pool.query('SELECT image_url FROM product_image WHERE product_id = ?', [req.params.id]);
  try {
    await pool.query('DELETE FROM product WHERE product_id = ?', [req.params.id]);
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED') {
      throw new HttpError(409, 'Cannot delete: this product has been ordered.');
    }
    throw err;
  }
  for (const row of imageRows) {
    const url = row.image_url || '';
    if (url.startsWith('/uploads/products/')) {
      fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(url))).catch(() => {});
    }
  }
  res.json({ success: true, data: { deleted: true } });
}));

module.exports = router;
