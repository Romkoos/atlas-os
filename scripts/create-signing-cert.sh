#!/bin/bash
# Create a local, self-signed code-signing identity named "Atlas OS Local" in the
# login keychain, so `pnpm dist` can sign Atlas OS with a STABLE identity.
#
# Why: a stable signing identity gives the app a stable TCC "designated
# requirement". macOS then keeps a one-time Full Disk Access grant across
# rebuilds. Ad-hoc signing changes the cdhash every build, so TCC forgets and the
# usage widget re-prompts for folder access on every launch.
#
# Run this ONCE, in your own terminal (it asks for your login-keychain password
# to let `codesign` use the new key without prompting on every build):
#
#     bash scripts/create-signing-cert.sh
#
# Not for distribution — the cert is self-signed; Gatekeeper still warns on other
# Macs. Purely to stabilize TCC on this machine.
set -euo pipefail

CN="Atlas OS Local"
KC="$HOME/Library/Keychains/login.keychain-db"
DIR="$(mktemp -d)"
trap 'rm -rf "$DIR"' EXIT

if security find-identity -v -p codesigning | grep -q "$CN"; then
  echo "Identity '$CN' already exists — nothing to do."
  security find-identity -v -p codesigning | grep "$CN"
  exit 0
fi

cat > "$DIR/v3.cnf" <<EOF
[req]
distinguished_name = dn
x509_extensions = v3
prompt = no
[dn]
CN = $CN
[v3]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
EOF

openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
  -keyout "$DIR/key.pem" -out "$DIR/cert.pem" -config "$DIR/v3.cnf"

openssl pkcs12 -export -inkey "$DIR/key.pem" -in "$DIR/cert.pem" \
  -out "$DIR/id.p12" -name "$CN" -passout pass:atlas

# Import the key+cert; -T lets codesign use it. -A avoids per-app ACL prompts.
security import "$DIR/id.p12" -k "$KC" -P atlas -A -T /usr/bin/codesign

# Let codesign use the private key without a GUI prompt on every build. This is
# the step that asks for your login-keychain password.
security set-key-partition-list -S apple-tool:,apple:,codesign: -s "$KC" >/dev/null

echo
echo "Created code-signing identity '$CN':"
security find-identity -v -p codesigning | grep "$CN"
