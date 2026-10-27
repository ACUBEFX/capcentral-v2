USE `Cap-Central`;

-- Each cap listing represents one unique physical item.
-- Available caps become quantity 1; sold-out caps remain quantity 0.
-- This does not change the stock of Shoes, Hats, or Thobes.
UPDATE products
SET stock_quantity = 1
WHERE category = 'Caps'
  AND stock_quantity > 1;
