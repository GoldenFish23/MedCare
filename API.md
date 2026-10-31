# MedCare Backend API Guide

This document lists the main backend endpoints, expected request bodies, and example payloads for the MedCare app.

Base URL:
- http://localhost:9000

Authentication:
- Most endpoints require an active session.
- Login via `POST /login` to obtain the session object.
- Use the session cookie or current app session handling from the backend.

## 1. Auth API

### GET /login
Returns login format information when no session is active.

Example response:
```json
{
  "message": "Login with user details ->",
  "format": {
    "username": "Username",
    "password": "Password"
  }
}
```

### POST /login
Login a user.

Request body:
```json
{
  "username": "admin",
  "password": "admin123",
  "role_id": 1
}
```

Example success response:
```json
{
  "message": "Login Successful -_-",
  "session": {
    "id": 1,
    "username": "admin",
    "full_name": "Admin User",
    "role_id": 1
  }
}
```

### POST /register
Register the super admin using the activation key.

Request body:
```json
{
  "username": "admin",
  "password": "admin123",
  "full_name": "Admin User",
  "activation_key": "ACTIVATION_KEY_FROM_DB"
}
```

Example success response:
```json
{
  "success": true,
  "message": "User created successfully",
  "redirect": "/login"
}
```

### POST /logout
Ends the active session.

Example response:
```json
{
  "message": "Session Logged Out Successfully -_-",
  "session": {
    "id": 1,
    "username": "admin",
    "full_name": "Admin User",
    "role_id": 1
  }
}
```

### POST /change-password
Change the current logged-in user's password.

Request body:
```json
{
  "current_password": "oldpass123",
  "new_password": "newpass456",
  "confirm_password": "newpass456"
}
```

Example success response:
```json
{
  "success": true,
  "message": "Password changed successfully."
}
```

### POST /forgot-password
Reset a password using username and full name.

Request body:
```json
{
  "username": "admin",
  "full_name": "Admin User",
  "new_password": "newpass456",
  "confirm_password": "newpass456"
}
```

Example success response:
```json
{
  "success": true,
  "message": "Password reset successfully. Please login again with the new password."
}
```

## 2. User API

### GET /user
List users.

Example response:
```json
[
  {
    "user_id": 1,
    "username": "admin",
    "full_name": "Admin User",
    "status": "Active",
    "user_created_at": "2026-01-01T10:00:00.000Z",
    "role_id": 1,
    "role_name": "ADMIN",
    "role_created_at": "2026-01-01T10:00:00.000Z"
  }
]
```

### POST /user
Create a user.

Request body:
```json
{
  "username": "cashier1",
  "password": "cashier123",
  "full_name": "Cashier One",
  "role_id": 2
}
```

Example success response:
```json
{
  "message": "User created successfully!",
  "user": {
    "username": "cashier1",
    "full_name": "Cashier One",
    "role_id": 2,
    "is_active": 1
  }
}
```

### DELETE /user
Deactivate a user by username.

Request body:
```json
{
  "username": "cashier1"
}
```

Example success response:
```json
{
  "message": "User Deleted successfully!",
  "user": {
    "username": "cashier1",
    "is_active": 0
  }
}
```

## 3. Supplier API

### GET /supplier
Lists all suppliers.

Example response:
```json
[
  {
    "id": 1,
    "name": "ABC Pharma",
    "phone": "9876543210",
    "gstin": "29ABCDE1234F1Z5",
    "address": "Bengaluru",
    "created_at": "2026-01-01T00:00:00.000Z"
  }
]
```

### POST /supplier
Create a supplier.

Request body:
```json
{
  "name": "ABC Pharma",
  "phone": "9876543210",
  "gstin": "29ABCDE1234F1Z5",
  "address": "Bengaluru"
}
```

Example success response:
```json
{
  "success": true,
  "message": "Supplier created successfully."
}
```

### PATCH /supplier
Update supplier details by name.

Request body:
```json
{
  "name": "ABC Pharma",
  "phone": "9999999999",
  "address": "New Address"
}
```

Example success response:
```json
{
  "success": true,
  "message": "Supplier \"ABC Pharma\" updated successfully -_-"
}
```

### DELETE /supplier
Delete supplier by name.

Request body:
```json
{
  "name": "ABC Pharma"
}
```

Example success response:
```json
{
  "success": true,
  "message": "Supplier Deleted Successfully.",
  "user": "ABC Pharma"
}
```

## 4. Medicine Category API

### GET /medicine_Catg
List categories.

Example response:
```json
{
  "message": "Medicine Category found !",
  "categories": [
    {
      "id": 1,
      "name": "Antibiotic",
      "description": "Used for bacterial infections"
    }
  ]
}
```

### POST /medicine_Catg
Create category.

Request body:
```json
{
  "name": "Antibiotic",
  "description": "Used for bacterial infections"
}
```

Example success response:
```json
{
  "success": true,
  "message": "Medicine category created successfully. -_-"
}
```

### DELETE /medicine_Catg
Delete category by id.

Request body:
```json
{
  "id": 1
}
```

Example success response:
```json
{
  "success": true,
  "message": "Medicine category deleted successfully."
}
```

## 5. Medicine API

### GET /medicine
List all medicines.

Example response:
```json
[
  {
    "id": 1,
    "name": "Paracetamol",
    "company": "MediCo",
    "category_id": 1,
    "hsn_code": "30049099",
    "rack_number": "A1",
    "gst_percent": 5,
    "min_stock_alert": 10,
    "created_at": "2026-01-01T00:00:00.000Z"
  }
]
```

### POST /medicine
Create a medicine.

Request body:
```json
{
  "name": "Paracetamol",
  "company": "MediCo",
  "category_id": 1,
  "hsn_code": "30049099",
  "rack_number": "A1",
  "gst_percent": 5,
  "min_stock_alert": 10
}
```

Example success response:
```json
{
  "success": true,
  "message": "Medicine created successfully."
}
```

### DELETE /medicine
Delete medicine by id.

Request body:
```json
{
  "id": 1
}
```

Example success response:
```json
{
  "success": true,
  "message": "Medicine deleted successfully."
}
```

## 6. Medicine Batch API

### POST /buy_Med_Supply
Add a medicine batch stock entry.

Request body:
```json
{
  "medicine_id": 1,
  "batch_number": "BATCH-001",
  "expiry_date": "2027-12-31",
  "purchase_price": 20,
  "selling_price": 25,
  "mrp": 30,
  "current_stock": 100
}
```

Example success response:
```json
{
  "success": true,
  "message": "Medicine batch created successfully."
}
```

## 7. Purchase API

### GET /buy
List purchase records. Optionally filter by invoice number.

Example request:
```http
GET /buy?invoice_number=INV-1001
```

Example response:
```json
{
  "success": true,
  "purchases": [
    {
      "id": 1,
      "supplier_id": 1,
      "invoice_number": "INV-1001",
      "invoice_date": "2026-01-10",
      "total_amount": 1500,
      "gst_amount": 100,
      "created_at": "2026-01-10T12:00:00.000Z",
      "supplier_name": "ABC Pharma"
    }
  ]
}
```

### POST /buy
Record a purchase transaction.

Request body:
```json
{
  "supplier_id": 1,
  "invoice_number": "INV-1001",
  "invoice_date": "2026-01-10",
  "payment_mode": "CASH",
  "total_amount": 1500,
  "gst_amount": 100,
  "items": [
    {
      "medicine_name": "Paracetamol",
      "quantity": 10,
      "purchase_price": 20,
      "selling_price": 25,
      "mrp": 30,
      "gst_percent": 5,
      "batch_number": "BATCH-001",
      "expiry_date": "2027-12-31"
    }
  ]
}
```

Example success response:
```json
{
  "success": true,
  "message": "Purchase recorded successfully.",
  "purchase": {
    "purchaseId": 1,
    "invoice_number": "INV-1001",
    "total_amount": 1500,
    "gst_amount": 100,
    "item_count": 1
  }
}
```

## 8. Sale API

### GET /sell
List sale records.

Example response:
```json
{
  "success": true,
  "sales": [
    {
      "id": 1,
      "invoice_number": "SALE-001",
      "customer_id": 1,
      "user_id": 1,
      "subtotal": 250,
      "discount": 0,
      "cgst": 0,
      "sgst": 0,
      "round_off": 0,
      "grand_total": 250,
      "payment_mode": "CASH",
      "created_at": "2026-01-11T08:30:00.000Z",
      "cashier_name": "admin"
    }
  ]
}
```

### POST /sell
Record a sale transaction.

Request body:
```json
{
  "invoice_number": "SALE-001",
  "customer_name": "Raj Kumar",
  "customer_phone": "9876543210",
  "customer_address": "Bengaluru",
  "payment_mode": "CASH",
  "discount": 0,
  "cgst": 0,
  "sgst": 0,
  "round_off": 0,
  "items": [
    {
      "medicine_name": "Paracetamol",
      "quantity": 2,
      "unit_price": 25,
      "gst_percent": 5
    }
  ]
}
```

Example success response:
```json
{
  "success": true,
  "message": "Sale recorded successfully.",
  "sale": {
    "saleId": 1,
    "subtotal": 50,
    "discount": 0,
    "cgst": 0,
    "sgst": 0,
    "round_off": 0,
    "grand_total": 50,
    "payment_mode": "CASH"
  }
}
```

## 9. Purchase Return API

### GET /purchase_return
List purchase returns.

Example response:
```json
{
  "success": true,
  "purchase_returns": [
    {
      "id": 1,
      "purchase_id": 1,
      "return_date": "2026-01-12T09:00:00.000Z",
      "total_refund_amount": 100,
      "invoice_number": "INV-1001",
      "supplier_name": "ABC Pharma"
    }
  ]
}
```

### POST /purchase_return
Record a purchase return.

Request body:
```json
{
  "purchase_id": 1,
  "items": [
    {
      "batch_id": 1,
      "quantity": 2
    }
  ]
}
```

Example success response:
```json
{
  "success": true,
  "message": "Purchase return recorded successfully.",
  "return": {
    "purchase_return_id": 1,
    "purchase_id": 1,
    "total_refund_amount": 50,
    "transaction_type": "PURCHASE_RETURN",
    "type": "PURCHASE_RETURN"
  }
}
```

## 10. Sale Return API

### GET /sale_return
List sale returns.

Example response:
```json
{
  "success": true,
  "sale_returns": [
    {
      "id": 1,
      "sale_id": 1,
      "user_id": 1,
      "total_refund_amount": 50,
      "invoice_number": "SALE-001",
      "customer_name": "Raj Kumar"
    }
  ]
}
```

### POST /sale_return
Record a sale return.

Request body:
```json
{
  "sale_id": 1,
  "items": [
    {
      "batch_id": 1,
      "quantity": 1
    }
  ]
}
```

Example success response:
```json
{
  "success": true,
  "message": "Sale return recorded successfully.",
  "return": {
    "sales_return_id": 1,
    "sale_id": 1,
    "total_refund_amount": 25,
    "transaction_type": "SALE_RETURN",
    "type": "SALE_RETURN"
  }
}
```

## 11. Stock API

### GET /stock
Get inventory stock list.

Example response:
```json
{
  "success": true,
  "stock": [
    {
      "id": 1,
      "medicine_id": 1,
      "medicine_name": "Paracetamol",
      "batch_number": "BATCH-001",
      "expiry_date": "2027-12-31",
      "purchase_price": 20,
      "selling_price": 25,
      "mrp": 30,
      "current_stock": 100,
      "category_name": "Antibiotic"
    }
  ]
}
```

## 12. Notifications API

### GET /notifications
Get notifications for current user or all for admin.

Example response:
```json
{
  "success": true,
  "notifications": [
    {
      "id": 1,
      "user_id": 1,
      "title": "Login successful",
      "message": "Welcome back, Admin User.",
      "type": "INFO",
      "is_read": 0,
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

### POST /notifications
Create a notification.

Request body:
```json
{
  "user_id": 1,
  "title": "Invoice created",
  "message": "Invoice SALE-001 has been generated.",
  "type": "INFO"
}
```

Example success response:
```json
{
  "success": true,
  "message": "Notification created successfully.",
  "notification": {
    "id": 1
  }
}
```

## 13. Activity & Tracking API

### GET /activity
Get latest activity log entries.

Example response:
```json
{
  "success": true,
  "activity": [
    {
      "id": 1,
      "user_id": 1,
      "action": "LOGIN",
      "entity_type": "user",
      "entity_id": 1,
      "details": "admin signed in",
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

### GET /tracking
Get summary tracking data for sales, suppliers, transactions, and recent activity.

Example response:
```json
{
  "success": true,
  "source": "live",
  "tracking": {
    "monthly_sales": [
      {
        "month": "2026-01",
        "total_sales": 1500
      }
    ],
    "top_supplier": [
      {
        "name": "ABC Pharma",
        "total_purchase": 5000
      }
    ],
    "transactions": [
      {
        "transaction_type": "SALE",
        "type": "SALE",
        "count": 10,
        "total": 2500
      }
    ],
    "recent_activity": [
      {
        "action": "CREATE_SALE",
        "details": "Sale SALE-001 recorded with amount 250",
        "username": "admin"
      }
    ]
  }
}
```

## 14. Backup and Archive API

### POST /backup
Create a manual database archive.

Example success response:
```json
{
  "success": true,
  "backup": {
    "archive_path": "C:/.../archive/medical_store_manual_2026-01.zip",
    "summary_path": "C:/.../archive/medical_store_manual_2026-01_summary.json",
    "reason": "manual",
    "month": "2026-01"
  },
  "message": "Database archive created successfully."
}
```

### GET /archives
List all archive files or search archives using query parameters.

Example requests:
```http
GET /archives
GET /archives?month=2026-01
GET /archives?query=supplier
GET /archives?month=2026-01&query=supplier
```

Example response:
```json
{
  "success": true,
  "archives": [
    {
      "name": "medical_store_manual_2026-01.zip",
      "path": "C:/.../archive/medical_store_manual_2026-01.zip",
      "size": 12345
    }
  ]
}
```

### GET /archive/search
Compatibility archive search route.

Example request:
```http
GET /archive/search?month=2026-01&query=supplier
```

## 15. Invoice API

### GET /invoice
Get all invoices or a specific invoice by number.

Example request:
```http
GET /invoice?invoice_number=SALE-001
```

Example response:
```json
{
  "success": true,
  "invoice": {
    "sale": {
      "id": 1,
      "invoice_number": "SALE-001",
      "grand_total": 250,
      "customer_name": "Raj Kumar",
      "cashier_name": "admin"
    },
    "purchase": null
  }
}
```

## 16. Search API

### GET /search_by
Search inside a whitelisted database table and column.

Example request:
```http
GET /search_by?table=medicines&col=name&value=Paracetamol&operator=LIKE
```

Example response:
```json
{
  "success": true,
  "results": [
    { "name": "Paracetamol" }
  ]
}
```

## Notes
- Most endpoints require a valid active session.
- Request and response formats are JSON.
- For production use, consider adding:
  - structured validation middleware
  - API versioning
  - rate limiting
  - JWT/session token security
  - request logging and audit trails
