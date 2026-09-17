# Reformer Pilates Stüdyo Yönetimi — Sıfırdan Kurulum

Bu klasör, uygulamanın YENİ bir GitHub + Vercel hesabında sıfırdan
yayınlanmaya hazır, tam ve son hâlidir. Supabase bağlantı bilgileri
`src/supabaseClient.js` içine önceden işlendi (eski, verilerinin
durduğu Supabase projesine bağlanıyor — veri kaybı olmaz).

## 0) ÖNCE BUNU KONTROL ET (çok önemli)

`src/supabaseClient.js` dosyasını aç. İçindeki `SUPABASE_URL` ve
`SUPABASE_ANON_KEY` değerlerinin, Supabase Dashboard → projen →
**Project Settings → API** sayfasında gördüğün **Project URL** ve
**anon / publishable key** ile birebir aynı olduğundan emin ol.
Şifre sıfırlama işlemi bu bilgileri değiştirmez ama bir kez göz atıp
doğrulaman, ileride "veritabanına bağlanılamadı" hatası yaşamamak
için en sağlam yöntem. Farklıysa, dosyadaki iki değeri Supabase'de
gördüklerinle değiştir.

## 1) Yeni GitHub reposu oluştur

1. github.com'da (istersen yeni hesapla) **New repository** de,
   boş bir repo oluştur (örn. `pilates-yonetim-v2`)
2. "Add file → Upload files" ile bu klasördeki **tüm dosya ve
   klasörleri** (gizli `.gitignore` dosyası dahil, `node_modules`
   ve `dist` YOK zaten burada) sürükle-bırak yükle
3. "Commit changes" de

## 2) Yeni Vercel hesabıyla yayınla

1. vercel.com'da (istersen yeni hesapla) hesap aç
2. "Add New... → Project" de, GitHub'ı bağla, az önce oluşturduğun
   repoyu seç
3. Vercel ayarları otomatik algılar (Framework: Vite) — hiçbir şeye
   dokunmadan **Deploy** de
4. 1-2 dakika içinde yeni bir link verecek (örn.
   `https://pilates-yonetim-v2-xxxx.vercel.app`)

## 3) Test et

Linke gir, PIN ile giriş yap. Şunları özellikle kontrol et:
- Üyelerin ve paketlerin hâlâ orada olduğunu (Supabase'e doğru
  bağlandığının kanıtı)
- **Telafiler** sekmesinin göründüğünü
- **Ders Programı**'nda "Bu Hafta" ve "Gelecek Hafta" olarak iki
  ayrı takvim olduğunu
- **PDF İndir** butonunun gerçekten dosya indirdiğini
- Bir üyenin detayında (yönetici girişiyle) **"Kalıcı Olarak Sil"**
  butonunun göründüğünü

## 4) Eski GitHub/Vercel projelerini istersen sil

Yeni kurulum sorunsuz çalıştığını doğruladıktan sonra, eski/karışık
GitHub reposunu ve Vercel projesini silmek istersen (karışıklık
olmasın diye) ikisinde de proje ayarlarının en altında "Delete
Project" seçeneği var. Acelesi yok, önce yenisinin çalıştığından
emin ol.

## 5) Bundan sonra değişiklik istersen

Bana yazman yeterli — güncellenmiş `src/App.jsx` dosyasını veririm,
sen de bu YENİ repodaki `src/App.jsx`'in üzerine yapıştırıp commit
edersin. Vercel otomatik olarak yeniden yayınlar.
