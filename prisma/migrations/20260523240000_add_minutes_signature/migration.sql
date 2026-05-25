ALTER TABLE "Meeting" ADD COLUMN "minutesSignedAt" TIMESTAMP(3);
ALTER TABLE "Meeting" ADD COLUMN "minutesSignedById" TEXT;
ALTER TABLE "Meeting" ADD COLUMN "minutesSignatureHash" TEXT;
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_minutesSignedById_fkey"
  FOREIGN KEY ("minutesSignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
