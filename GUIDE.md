# Panduan Penggunaan Tunnel App

Dokumen ini menjelaskan cara menghosting server (untuk Kamu/Admin) dan cara menggunakan layanan ini (untuk User).

---

## 🏗️ Bagian 1: Panduan untuk Host (Server AWS)

Sebagai host, tugas kamu adalah menjalankan server yang akan menerima koneksi dari user dan membuka port publik untuk mereka.

### 1. Persiapan Server (AWS)
Pastikan kamu memiliki akses SSH ke server AWS kamu.

1.  **Upload Folder Server**:
    Salin folder `server/` ke dalam VPS/AWS kamu.

2.  **Buka Firewall (Security Groups)**:
    Kamu harus membuka port di AWS Security Group (Ingress Rules):
    *   **Port 5000 (TCP)**: Untuk jalur kontrol (wajib).
    *   **Port 1024 - 65535 (TCP & UDP)**: Range port yang bisa digunakan user.

### 2. Menjalankan Server
Masuk ke folder `server` dan jalankan script startup.

**Cara Manual (Testing):**
```bash
cd server
chmod +x start-server.sh
./start-server.sh
```

**Cara Otomatis (Production/PM2):**
Agar server tetap jalan walaupun kamu logout, gunakan `pm2` (pastikan Node.js sudah terinstall).
```bash
# Install pm2 jika belum ada
npm install -g pm2

# Jalankan server
cd server
pm2 start server.js --name "tunnel-server"
pm2 save
```

### 3. Konfigurasi Rahasia
Secara default, password koneksi adalah `mysupersecretpassword`.
Jika ingin menggantinya, edit file `start-server.sh` atau set environment variable `SECRET_KEY` sebelum menjalankan server.

---

## 💻 Bagian 2: Panduan untuk User (Client)

Ini adalah panduan yang bisa kamu berikan kepada User yang ingin menggunakan layanan tunnel kamu.

### 1. Download Client
User hanya membutuhkan folder `client/`. Berikan folder tersebut kepada mereka.

### 2. Konfigurasi
User harus mengedit file `config.json` di dalam folder `client`.

**Contoh `config.json`:**
```json
{
  "server": "x3lxbhrf9h9u9ygt3cwd35prquvgxykj.vryakn.web.id",
  "controlPort": 5000,
  "secret": "mysupersecretpassword",
  "tunnels": [
    {
      "protocol": "tcp",
      "remote": 8080,
      "local": 80
    },
    {
      "protocol": "udp",
      "remote": 0,
      "local": 3000
    }
  ]
}
```

**Penjelasan Setting:**
*   `server`: Domain atau IP Public server tunnel (Jangan diubah user kecuali server pindah).
*   `secret`: Password rahasia yang diberikan oleh Host.
*   `tunnels`: Daftar port yang ingin dibuka.
    *   `protocol`: `tcp` atau `udp`.
    *   `local`: Port di komputer user (misal: 80 untuk web, 3000 untuk game dev).
    *   `remote`: Port publik di AWS yang diinginkan.
        *   Isi angka spesifik (misal `8080`) jika ingin request port tertentu.
        *   Isi `0` jika ingin **Server memilihkan port acak** (berguna jika port favorit sudah dipakai orang lain).

### 3. Menjalankan Tunnel
Pastikan User sudah menginstall **Node.js**.

**Di Windows / Linux / Mac:**
Buka terminal/cmd, masuk ke folder `client`, lalu ketik:
```bash
node client.js
```
*Atau user Windows bisa double click jika dibuatkan file `.bat`.*

### 4. Mengetahui Port
Jika User memilih `"remote": 0`, perhatikan log saat aplikasi berjalan.
*   Server akan memberikan port acak, misalnya `45123`.
*   Akses publiknya menjadi: `x3lxbhrf9h9u9ygt3cwd35prquvgxykj.vryakn.web.id:45123` -> Masuk ke Komputer User port `3000`.

---

## ❓ Troubleshooting

**Q: Server menolak koneksi (Connection Refused)?**
A: Pastikan Host sudah menjalankan server dan port 5000 sudah dibuka di Firewall AWS.

**Q: Port "Available" tapi tidak bisa diakses dari luar?**
A: Pastikan range port (misal 8080) sudah di-allow di "Inbound Rules" AWS Security Group.

**Q: Error "Port already in use"?**
A: User lain mungkin sudah memakai port tersebut. Ganti `remote` ke port lain atau gunakan `0` untuk random.
