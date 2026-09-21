-- ============================================================
-- StorePanel — MySQL schema
-- Run:  mysql -u root -p < schema.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS storepanel DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE storepanel;

-- 1. SUBSCRIPTION TABLE
CREATE TABLE IF NOT EXISTS subscription (
    subscription_id INT AUTO_INCREMENT PRIMARY KEY,
    plan VARCHAR(100) NOT NULL,
    number_of_clients INT DEFAULT 0,
    number_of_products INT DEFAULT 0,
    price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    validity_days INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by INT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. USER TABLE
CREATE TABLE IF NOT EXISTS user (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    reg_phone VARCHAR(20) NOT NULL,
    alt_phone VARCHAR(20) NULL,
    email VARCHAR(255) NULL,                   -- optional; identity is the mobile number
    password_hash VARCHAR(255) NOT NULL,
    session_token CHAR(64) NULL,               -- active session token (single-session enforcement)
    is_active TINYINT(1) NOT NULL DEFAULT 0,   -- admin kill switch: 1 = enabled, 0 = admin-disabled (set directly in DB)
    subscription_id INT NULL,
    sub_valid_from DATE NULL,
    sub_valid_to DATE NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by INT NULL,

    CONSTRAINT fk_user_subscription
        FOREIGN KEY (subscription_id) REFERENCES subscription(subscription_id)
        ON DELETE SET NULL ON UPDATE CASCADE,

    UNIQUE KEY uk_user_email (email),
    UNIQUE KEY uk_user_reg_phone (reg_phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. ADDRESS TABLE
CREATE TABLE IF NOT EXISTS address (
    address_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    address_line_1 VARCHAR(255) NOT NULL,
    address_line_2 VARCHAR(255) NULL,
    city VARCHAR(100) NOT NULL,
    state VARCHAR(100) NOT NULL,
    country VARCHAR(100) NOT NULL DEFAULT 'India',
    pincode VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by INT NULL,

    CONSTRAINT fk_address_user
        FOREIGN KEY (user_id) REFERENCES user(user_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. CATEGORY TABLE
CREATE TABLE IF NOT EXISTS category (
    category_id INT AUTO_INCREMENT PRIMARY KEY,
    category VARCHAR(150) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by INT NULL,

    UNIQUE KEY uk_category_name (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. PRODUCT TABLE
CREATE TABLE IF NOT EXISTS product (
    product_id INT AUTO_INCREMENT PRIMARY KEY,
    vendor_id INT NOT NULL,
    category_id INT NOT NULL,
    product VARCHAR(255) NOT NULL,
    description TEXT NULL,
    quantity VARCHAR(50) NULL,                 -- packaging / unit quantity, e.g. '2kg', '3 nos', '400 gram'
    selling_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    date DATE NULL,
    stock_quantity INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by INT NULL,

    CONSTRAINT fk_product_vendor
        FOREIGN KEY (vendor_id) REFERENCES user(user_id)
        ON DELETE CASCADE ON UPDATE CASCADE,

    CONSTRAINT fk_product_category
        FOREIGN KEY (category_id) REFERENCES category(category_id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. CART TABLE
CREATE TABLE IF NOT EXISTS cart (
    cart_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL DEFAULT 1 COMMENT 'quantity requested; stock moves only when vendor confirms',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by INT NULL,

    CONSTRAINT fk_cart_user
        FOREIGN KEY (user_id) REFERENCES user(user_id)
        ON DELETE CASCADE ON UPDATE CASCADE,

    CONSTRAINT fk_cart_product
        FOREIGN KEY (product_id) REFERENCES product(product_id)
        ON DELETE CASCADE ON UPDATE CASCADE,

    UNIQUE KEY uk_cart_user_product (user_id, product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. CHECKOUT TABLE
CREATE TABLE IF NOT EXISTS checkout (
    checkout_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by INT NULL,

    CONSTRAINT fk_checkout_user
        FOREIGN KEY (user_id) REFERENCES user(user_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. ORDER TABLE (ORDER is a reserved keyword → use backticks)
CREATE TABLE IF NOT EXISTS `order` (
    order_id INT AUTO_INCREMENT PRIMARY KEY,
    checkout_id INT NOT NULL,
    user_id INT NOT NULL,
    vendor_id INT NOT NULL,
    address_id INT NOT NULL,
    total_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    status VARCHAR(50) DEFAULT 'pending',
    delivery_otp VARCHAR(10) NULL,
    stock_deducted TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'stock decremented once the vendor confirms this order',
    vendor_note TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by INT NULL,

    CONSTRAINT fk_order_checkout
        FOREIGN KEY (checkout_id) REFERENCES checkout(checkout_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,

    CONSTRAINT fk_order_user
        FOREIGN KEY (user_id) REFERENCES user(user_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,

    CONSTRAINT fk_order_vendor
        FOREIGN KEY (vendor_id) REFERENCES user(user_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,

    CONSTRAINT fk_order_address
        FOREIGN KEY (address_id) REFERENCES address(address_id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. ORDER ITEM TABLE
CREATE TABLE IF NOT EXISTS order_item (
    order_item_id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    vendor_id INT NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    unit_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    total_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by INT NULL,

    CONSTRAINT fk_order_item_order
        FOREIGN KEY (order_id) REFERENCES `order`(order_id)
        ON DELETE CASCADE ON UPDATE CASCADE,

    CONSTRAINT fk_order_item_product
        FOREIGN KEY (product_id) REFERENCES product(product_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,

    CONSTRAINT fk_order_item_vendor
        FOREIGN KEY (vendor_id) REFERENCES user(user_id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Product media and specifications for the mobile product-detail experience
CREATE TABLE IF NOT EXISTS product_image (
    img_id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    image_url VARCHAR(500) NOT NULL,
    is_primary TINYINT(1) DEFAULT 0,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by INT NULL,
    CONSTRAINT fk_product_image_product
        FOREIGN KEY (product_id) REFERENCES product(product_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_specification (
    product_specification_id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    spec TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by INT NULL,
    CONSTRAINT fk_product_specification_product
        FOREIGN KEY (product_id) REFERENCES product(product_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Per-order-item delivery tracking. One row per order item (unique order_item_id).
-- status uses the full 10-state lifecycle used across the app:
--   pending, confirmed, processing, packed, shipped, out_for_delivery,
--   delivered, cancelled, returned, failed
CREATE TABLE IF NOT EXISTS delivery_status (
    delivery_status_id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    order_item_id INT NOT NULL,
    product_id INT NOT NULL,
    vendor_id INT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    tracking_number VARCHAR(100) NULL,
    courier_name VARCHAR(150) NULL,
    shipped_at DATETIME NULL,
    expected_delivery_date DATE NULL,
    delivered_at DATETIME NULL,
    delivery_note TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by INT NULL,

    UNIQUE KEY uk_delivery_status_order_item (order_item_id),
    INDEX idx_delivery_status_order (order_id),
    INDEX idx_delivery_status_vendor (vendor_id),

    CONSTRAINT fk_delivery_status_order
        FOREIGN KEY (order_id) REFERENCES `order`(order_id)
        ON DELETE CASCADE ON UPDATE CASCADE,

    CONSTRAINT fk_delivery_status_order_item
        FOREIGN KEY (order_item_id) REFERENCES order_item(order_item_id)
        ON DELETE CASCADE ON UPDATE CASCADE,

    CONSTRAINT fk_delivery_status_product
        FOREIGN KEY (product_id) REFERENCES product(product_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,

    CONSTRAINT fk_delivery_status_vendor
        FOREIGN KEY (vendor_id) REFERENCES user(user_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Vendor↔client link table: one row per (vendor, client) pair, so a vendor can
-- have MANY clients and the SAME client account can be linked to MANY vendors.
--   client_id NULL + staged_reg_phone → pending invite for a mobile number
--   client_id set + status 0          → linked account, awaiting this vendor's OTP
--   client_id set + status 1          → verified client of this vendor
CREATE TABLE IF NOT EXISTS vendor_client (
    vendor_client_id INT AUTO_INCREMENT PRIMARY KEY,
    vendor_id INT NOT NULL,
    client_id INT NULL,
    staged_reg_phone VARCHAR(20) NULL,
    status TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by INT NULL,
    UNIQUE KEY uk_vendor_client (vendor_id, client_id),
    UNIQUE KEY uk_vendor_staged_phone (vendor_id, staged_reg_phone),
    INDEX idx_vc_client (client_id),
    CONSTRAINT fk_vc_vendor FOREIGN KEY (vendor_id) REFERENCES user(user_id) ON DELETE CASCADE,
    CONSTRAINT fk_vc_client FOREIGN KEY (client_id) REFERENCES user(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Verification codes for client invites (a code expires after 10 minutes).
CREATE TABLE IF NOT EXISTS client_verification (
    client_verification_id INT AUTO_INCREMENT PRIMARY KEY,
    vendor_client_id INT NOT NULL,
    otp_hash CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    attempt_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_client_verification_pair (vendor_client_id),
    CONSTRAINT fk_client_verification_pair FOREIGN KEY (vendor_client_id) REFERENCES vendor_client(vendor_client_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Seed data: subscription plans & categories
-- ============================================================

INSERT INTO subscription (plan, number_of_clients, number_of_products, price, validity_days) VALUES
('Silver',      5,    10,   499.00,  30),
('Gold',        20,   50,   999.00,  30),
('Premium',     100,  200,  1999.00, 60),
('Enterprise',  1000, 1000, 4999.00, 90);

INSERT INTO category (category) VALUES
('Electronics'),
('Groceries & Food'),
('Fashion'),
('Home & Kitchen'),
('Books & Stationery'),
('Sports & Fitness');
