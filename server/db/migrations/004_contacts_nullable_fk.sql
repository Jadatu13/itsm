-- Allow tickets to exist without a linked contact (for deleted contacts)
ALTER TABLE tickets ALTER COLUMN contact_id DROP NOT NULL;
