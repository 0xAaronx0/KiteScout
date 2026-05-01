-- Add WhatsApp and phone number fields to providers
ALTER TABLE providers ADD COLUMN IF NOT EXISTS whatsapp TEXT;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS phone TEXT;
