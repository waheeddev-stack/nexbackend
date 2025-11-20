-- Trigger to automatically calculate earnings when order status changes to 'delivered'
DELIMITER $$

CREATE TRIGGER calculate_earnings_on_delivery
AFTER UPDATE ON orders
FOR EACH ROW
BEGIN
    -- Only process when order status changes to 'delivered'
    IF NEW.status = 'delivered' AND OLD.status != 'delivered' THEN
        -- Calculate earning amount based on order total
        SET @earning_amount = CASE
            WHEN NEW.total_amount <= 100 THEN 5
            WHEN NEW.total_amount <= 300 THEN 8
            ELSE 15
        END;
        
        SET @earning_rate = CASE
            WHEN NEW.total_amount <= 100 THEN '5 (≤100)'
            WHEN NEW.total_amount <= 300 THEN '8 (100-300)'
            ELSE '15 (>300)'
        END;
        
        -- Insert or update order_earnings record
        INSERT INTO order_earnings (
            order_id, 
            shopkeeper_id, 
            order_amount, 
            earning_amount, 
            earning_rate, 
            payment_cycle_start, 
            payment_cycle_end, 
            is_paid
        ) VALUES (
            NEW.id,
            NEW.shopkeeper_id,
            NEW.total_amount,
            @earning_amount,
            @earning_rate,
            CURDATE(),
            DATE_ADD(CURDATE(), INTERVAL 15 DAY),
            FALSE
        ) ON DUPLICATE KEY UPDATE
            order_amount = NEW.total_amount,
            earning_amount = @earning_amount,
            earning_rate = @earning_rate;
        
        -- Update or create earnings record for shopkeeper
        INSERT INTO earnings (shopkeeper_id, pending_amount, last_payment_date, next_payment_date)
        VALUES (
            NEW.shopkeeper_id,
            @earning_amount,
            CURRENT_TIMESTAMP,
            DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 15 DAY)
        ) ON DUPLICATE KEY UPDATE
            pending_amount = pending_amount + @earning_amount,
            updated_at = CURRENT_TIMESTAMP;
            
        -- Update payment status based on next payment date
        UPDATE earnings 
        SET payment_status = CASE
            WHEN DATEDIFF(next_payment_date, CURDATE()) < 0 AND pending_amount > 0 THEN 'blocked'
            WHEN DATEDIFF(next_payment_date, CURDATE()) <= 2 AND pending_amount > 0 THEN 'overdue'
            WHEN DATEDIFF(next_payment_date, CURDATE()) <= 7 AND pending_amount > 0 THEN 'due_soon'
            ELSE 'active'
        END
        WHERE shopkeeper_id = NEW.shopkeeper_id;
    END IF;
END$$

DELIMITER ;

-- Procedure to update payment statuses (run this periodically via cron job)
DELIMITER $$

CREATE PROCEDURE UpdatePaymentStatuses()
BEGIN
    UPDATE earnings 
    SET payment_status = CASE
        WHEN DATEDIFF(next_payment_date, CURDATE()) < 0 AND pending_amount > 0 THEN 'blocked'
        WHEN DATEDIFF(next_payment_date, CURDATE()) <= 2 AND pending_amount > 0 THEN 'overdue'
        WHEN DATEDIFF(next_payment_date, CURDATE()) <= 7 AND pending_amount > 0 THEN 'due_soon'
        ELSE 'active'
    END
    WHERE pending_amount > 0;
END$$

DELIMITER ;