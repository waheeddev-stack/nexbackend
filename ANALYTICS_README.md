# Shopkeeper Analytics API Documentation

This document explains the `/api/shopkeeper/analytics` endpoint used by the Shopkeeper App.

## Endpoint Details
- **Route:** `GET /api/shopkeeper/analytics`
- **Authentication:** Required (Valid JWT token needed)
- **Role Check:** Requires the user to be an active, verified shopkeeper.

## Query Parameters
- `timeframe`: (Optional) Specifies the period for data calculation. Allowed values: `daily`, `weekly`, `monthly`. Defaults to `weekly`.

## Calculation Logic

The API calculates various metrics using SQL queries against the MySQL/TiDB database. Here is how each metric is derived:

### Date Filtering (`timeframe`)
- **daily**: Last 7 days (compared to the previous 7 days for growth).
- **weekly**: Last 7 days (compared to the previous 7 days).
- **monthly**: Last 1 month (compared to the previous 1 month).

### 1. Total Sales (`totalSales`)
Calculates the sum of the `total_amount` field in the `orders` table.
Only orders with a `status` of `'Completed'` or `'Delivered'` are included in the revenue. 

### 2. Growth Percentage (`growth`)
Compares the current period's `totalSales` against the previous equivalent period. 
Formula: `((current_sales - previous_sales) / previous_sales) * 100`.

### 3. Received Percentage (`receivedPct`)
Calculates the percentage of orders successfully fulfilled.
Formula: `(completed_orders_count / total_orders_count) * 100`.

### 4. Pending Orders (`pendingOrders`)
Counts the total number of orders that currently have a `status` of `'Pending'` for this shopkeeper.

### 5. Low Stock Count (`lowStockCount`)
Counts the number of products belonging to the shopkeeper where the current `stock` is less than or equal to the `baselineQty` or less than or equal to 5.

### 6. Chart Data (`chartData`)
Returns an array of daily/weekly revenue data used to populate the bar charts in the frontend. It groups `total_amount` by `DATE` or `WEEK` depending on the timeframe.

### 7. Top Products (`topProducts`)
Returns the top 5 highest-selling products. It joins the `order_items` table with `products` and aggregates `SUM(quantity)` for completed/delivered orders.

### 8. Top Customers (`topCustomers`)
Returns the top 5 customers with the highest lifetime value (for the given timeframe) for this specific shopkeeper. It joins the `orders` table with the `users` table and calculates `SUM(total_amount)`.

## Example Response
```json
{
  "success": true,
  "timeframe": "weekly",
  "totalSales": 14500.50,
  "growth": 12.5,
  "chartData": [
    { "day": "2026-07-06", "revenue": 1500 },
    { "day": "2026-07-07", "revenue": 2100 }
  ],
  "receivedPct": 95.5,
  "pendingOrders": 3,
  "lowStockCount": 8,
  "topProducts": [
    { "id": 101, "name": "Milk", "sold": 45 },
    { "id": 102, "name": "Bread", "sold": 30 }
  ],
  "topCustomers": [
    { "id": 501, "name": "Riya Sharma", "spent": 4500 },
    { "id": 502, "name": "Arjun Mehta", "spent": 3200 }
  ]
}
```
