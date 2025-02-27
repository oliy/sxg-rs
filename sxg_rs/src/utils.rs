// Copyright 2021 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

pub fn get_sha(bytes: &[u8]) -> Vec<u8> {
    use ::sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher.finalize().to_vec()
}

#[cfg(test)]
pub mod tests {
    // Generated with:
    //   KEY=`mktemp` && CSR=`mktemp` &&
    //   openssl ecparam -out "$KEY" -name prime256v1 -genkey &&
    //   openssl req -new -sha256 -key "$KEY" -out "$CSR" -subj '/CN=example.org/O=Test/C=US' &&
    //   openssl x509 -req -days 90 -in "$CSR" -signkey "$KEY" -out - -extfile <(echo -e "1.3.6.1.4.1.11129.2.1.22 = ASN1:NULL\nsubjectAltName=DNS:example.org") &&
    //   rm "$KEY" "$CSR"
    pub const SELF_SIGNED_CERT_PEM: &str = "
-----BEGIN CERTIFICATE-----
MIIBkTCCATigAwIBAgIUL/D6t/l3OrSRCI0KlCP7zH1U5/swCgYIKoZIzj0EAwIw
MjEUMBIGA1UEAwwLZXhhbXBsZS5vcmcxDTALBgNVBAoMBFRlc3QxCzAJBgNVBAYT
AlVTMB4XDTIxMDgyMDAwMTc1MFoXDTIxMTExODAwMTc1MFowMjEUMBIGA1UEAwwL
ZXhhbXBsZS5vcmcxDTALBgNVBAoMBFRlc3QxCzAJBgNVBAYTAlVTMFkwEwYHKoZI
zj0CAQYIKoZIzj0DAQcDQgAE3jibTycCk9tifTFg6CyiUirdSlblqLoofEC7B0I4
IO9A52fwDYjZfwGSdu/6ji0MQ1+19Ovr3d9DvXSa7pN1j6MsMCowEAYKKwYBBAHW
eQIBFgQCBQAwFgYDVR0RBA8wDYILZXhhbXBsZS5vcmcwCgYIKoZIzj0EAwIDRwAw
RAIgdTuJ4IXs6LeXQ15TxIsRtfma4F8ypUk0bpBLLbVPbyACIFYul0BjPa2qVd/l
SFfkmh8Fc2QXpbbaK5AQfnQpkDHV
-----END CERTIFICATE-----
    ";

    // Generated from above cert using:
    //   openssl x509 -in - -outform DER | openssl dgst -sha256 -binary | base64 | tr /+ _- | tr -d =
    pub const SELF_SIGNED_CERT_SHA256: &str = "Lz2EMcys4NR9FP0yYnuS5Uw8xM3gbVAOM2lwSBU9qX0";
}
