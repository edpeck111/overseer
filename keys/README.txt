OVERSEER KEY MANAGEMENT
=======================

This directory holds Ed25519 keypairs for the OVERSEER system.

STRUCTURE:
  admin_private.pem     - OPi5 system admin private key (burns onto OPi5)
  admin_public.pem      - Admin public key (registered in DB automatically)
  <callsign>_private.pem - Per-user private keys (burn onto each user's Pi Zero)
  <callsign>_public.pem  - Per-user public keys (registered on OPi5 via admin UI)

PI ZERO SETUP WORKFLOW:
  1. On the OPi5 admin panel (SYSTEM > ADMIN), enter a callsign and click
     GENERATE KEYPAIR. This downloads the private key and fills the public key.
  2. Click REGISTER to save the public key on the OPi5.
  3. Copy the downloaded <callsign>_private_key.pem to this keys/ directory
     as a backup.
  4. Flash the Pi Zero SD card with the client image.
  5. Copy the private key onto the Pi Zero at:
       /home/overseer/keys/identity.pem
  6. The Pi Zero client reads identity.pem on boot to authenticate with
     the OPi5 when syncing messages over LoRa/Meshtastic.

SECURITY:
  - Private keys NEVER leave the device they belong to (except during
    initial provisioning).
  - The OPi5 only stores public keys.
  - Messages are encrypted end-to-end using recipient's public key.
  - Even if the OPi5 is compromised, message contents remain encrypted.
