# bot-noxarianet

Bot WhatsApp untuk `noxarianet store` yang menggunakan `Baileys` untuk koneksi WhatsApp dan `Supabase` untuk memantau order baru secara realtime.

## Gambaran Umum

Bot ini bekerja sebagai penghubung antara database order di Supabase dan WhatsApp.

Alur sederhananya:

1. Customer membuat order di website atau sistem toko.
2. Data order masuk ke tabel `orders` di Supabase.
3. Bot memantau perubahan data tersebut melalui `Supabase Realtime`.
4. Saat ada order baru, bot menyusun pesan notifikasi.
5. Bot mengirim pesan ke grup WhatsApp toko/admin.
6. Bot juga mengirim pesan konfirmasi ke nomor WhatsApp pembeli.

## Cara Kerja Bot

Secara umum, file utama proyek ada di `index.js` dan menjalankan beberapa tugas berikut:

1. Memuat konfigurasi dari file `.env`.
2. Membuat koneksi ke Supabase.
3. Membuka sesi WhatsApp menggunakan Baileys.
4. Mengambil daftar grup WhatsApp yang diikuti akun bot.
5. Menentukan grup target berdasarkan nama grup yang mengandung kata kunci `noxarianet`.
6. Mendengarkan pesan masuk dari WhatsApp.
7. Mendengarkan perubahan data order dari Supabase.

Selain fungsi notifikasi order, bot juga memiliki fitur:

- Menampilkan menu bantuan saat menerima command seperti `.noxa`
- Merespons interaksi menu
- Mengirim greeting saat ada member baru masuk grup
- Menyediakan fallback polling database jika realtime tidak aktif

## Login WhatsApp (QR / OTP)

Sesi disimpan di folder `auth_info_baileys` dengan **path absolut** (relatif terhadap lokasi `index.js`), sehingga sesi tetap ditemukan apapun working directory saat bot dijalankan. Selama sesi valid, **restart bot TIDAK memerlukan login ulang**.

### Metode 1: QR Code (default)

```bash
npm start
# atau eksplisit:
node index.js qr
```

Scan QR yang muncul di terminal: **WhatsApp > Perangkat Tertaut > Tautkan Perangkat**.

### Metode 2: OTP / Pairing Code

```bash
node index.js otp
```

Bot akan menanyakan nomor WA (atau ambil dari env), lalu menampilkan kode 8 digit. Masukkan kode di HP: **WhatsApp > Perangkat Tertaut > Tautkan Perangkat > Tautkan dengan nomor telepon**.

Atur lewat `.env` agar tidak perlu input manual (cocok untuk pm2/panel):

```env
LOGIN_METHOD=otp
PHONE_NUMBER=6281234567890
```

Catatan:

- Nomor harus format internasional tanpa `+` atau strip.
- Mode OTP hanya dipakai saat sesi belum terdaftar; setelah berhasil pairing, restart berikutnya langsung online tanpa login.
- Jika ingin ganti nomor/login dari nol: hapus folder `auth_info_baileys`, lalu jalankan lagi.

## Kenapa Dulu Harus Login Ulang Tiap Restart?

Perbaikan yang dilakukan pada `index.js`:

1. **Path sesi absolut** (`path.join(__dirname, "auth_info_baileys")`) — sebelumnya relatif CWD, sehingga menjalankan bot dari folder lain membuat folder sesi kosong baru.
2. **Logout (401) tidak langsung menghapus sesi** — kode 401 kadang muncul spurius; sekarang bot reconnect dulu, hapus sesi hanya jika logout terjadi berulang.
3. **Browser standar** (`Browsers.ubuntu("Chrome")`) — browser string custom memicu logout sering karena dianggap klien tidak dikenal.
4. **Graceful shutdown** (`SIGINT`/`SIGTERM`) — koneksi ditutup rapi agar `creds.json` tidak korup saat proses dimatikan.
5. **Penanganan disconnect lengkap** — `restartRequired` (515) reconnect cepat, `badSession` bersihkan sesi, reconnect lainnya dengan backoff.

## Cara Kerja Bot Mengirim Pesan Saat Ada Order Masuk

Saat ada data order baru masuk ke tabel `orders`, bot akan:

1. Mengambil data order baru dari payload Supabase.
2. Menyusun isi notifikasi, misalnya:
   - ID order
   - nama produk
   - varian
   - harga
   - metode pembayaran
   - nomor WhatsApp pembeli
   - email
   - catatan/testimonial
   - waktu order
3. Mencari grup tujuan:
   - menggunakan `cachedGroupId` jika sudah pernah ditemukan
   - atau mencari grup dengan nama yang mengandung `noxarianet`
   - atau fallback ke `targetGroupId`
4. Mengirim notifikasi ke grup WhatsApp
5. Mengirim pesan pribadi ke pembeli sebagai konfirmasi bahwa order sudah diterima

Jika order memiliki `proof_image`, bot akan mencoba mengirim gambar tersebut beserta caption. Jika gagal mengambil gambar, bot akan mengirim teks biasa.

## Keterangan Refund di Notifikasi Order Gagal

Saat order berubah menjadi `FAILED`, bot mengecek apakah saldo pembeli sudah dikembalikan, lalu menampilkan keterangannya di pesan grup (WhatsApp + Telegram).

- Refund ke saldo hanya berlaku untuk order dengan `payment_type = 'balance'` **dan** `user_id` terisi. Order gateway tidak pernah memotong saldo, jadi tidak ada baris refund yang ditampilkan.
- Sumber kebenaran adalah tabel `balance_transactions` (`type = 'refund'`, `reference_id = orders.id`, `status = 'completed'`), bukan tebakan dari status order.
- Backend menulis status `FAILED` lebih dulu, baru memanggil refund. Karena itu bot mengulang pengecekan beberapa kali (maks ±3,5 detik) sebelum menyimpulkan hasilnya.
- Hasil yang mungkin muncul:
  - `REFUND SALDO ✅` — saldo sudah dikembalikan, lengkap dengan nominal dan waktu refund (WIB).
  - `REFUND SALDO ⏳` — order saldo tapi bukti refund belum ada (mis. order tertahan di `REFUND_PENDING`); admin perlu cek riwayat saldo user.
- Kalau pengecekan gagal (mis. koneksi Supabase bermasalah), notifikasi order tetap dikirim dan kesalahan hanya dicatat di log bot.

## Event Supabase Yang Bisa Dimanfaatkan

Bot ini saat ini menggunakan `postgres_changes` dari `Supabase Realtime`.

Event utama yang bisa dimanfaatkan:

- `INSERT`  
  Dipicu saat ada baris baru dibuat. Cocok untuk notifikasi order baru.

- `UPDATE`  
  Dipicu saat data baris diperbarui. Cocok untuk notifikasi perubahan status order, misalnya dari `pending` menjadi `paid` atau `completed`.

- `DELETE`  
  Dipicu saat data baris dihapus. Cocok untuk audit log atau peringatan ke admin.

- `*`  
  Wildcard untuk menangkap semua event: `INSERT`, `UPDATE`, dan `DELETE`.

## Event Yang Dipakai Saat Ini

Saat ini bot menggunakan event berikut pada tabel `orders`:

```js
supabase
  .channel('public:orders')
  .on(
    'postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'orders' },
    async (payload) => {
      // proses order baru
    }
  )
```

Artinya, bot hanya akan otomatis mengirim notifikasi ketika ada order baru masuk ke tabel `orders`.

## Fallback Jika Realtime Gagal

Selain realtime, bot juga memiliki mekanisme polling database setiap 10 detik.

Tujuannya:

- memastikan order baru tetap terdeteksi
- mengurangi risiko notifikasi terlewat
- menjadi cadangan jika koneksi realtime terputus

## Teknologi Yang Digunakan

- `@whiskeysockets/baileys` untuk koneksi WhatsApp
- `@supabase/supabase-js` untuk akses database dan realtime
- `ws` untuk transport websocket Supabase
- `axios` untuk mengambil gambar bukti pembayaran
- `qrcode-terminal` untuk menampilkan QR login WhatsApp
- `dotenv` untuk konfigurasi environment

## Menjalankan Proyek

Install dependency:

```bash
npm install
```

Jalankan bot:

```bash
npm start
```

## Konfigurasi Environment

Pastikan file `.env` berisi minimal:

```env
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key

# Opsional, untuk mode login OTP tanpa input manual:
LOGIN_METHOD=otp
PHONE_NUMBER=6281234567890
```

## Catatan

- Bot ini tidak membuat order, hanya memantau tabel `orders` dan mengirim notifikasi berdasarkan perubahan data.
- Akun WhatsApp bot harus tetap login agar pengiriman pesan berjalan.
- Jika grup target tidak ditemukan otomatis, bot akan menggunakan `targetGroupId` yang sudah ditentukan di kode.
