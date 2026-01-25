Put your TLS certificate here to enable HTTPS (required for Android PWA install prompt).

Files expected:
- key.pem  (private key)
- cert.pem (certificate)

Quick self-signed example (PC):
  openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365 \
    -subj "/CN=REAPER-RM" \
    -addext "subjectAltName=IP:192.168.1.21,DNS:reaper.local"

Then access:
  https://192.168.1.21:3000

NOTE: For Chrome/Android, the certificate must be trusted by the device to be treated as a secure context.
Alternative dev workaround (Chrome):
  chrome://flags/#unsafely-treat-insecure-origin-as-secure  -> add http://192.168.1.21:3000
