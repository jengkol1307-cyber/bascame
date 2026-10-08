import Link from "next/link";

const mountains = [
  {
    name: "Gunung Rinjani",
    location: "Lombok, Nusa Tenggara Barat",
    status: "Buka",
    statusClass: "status-open",
    elevation: "3.726 mdpl",
  },
  {
    name: "Gunung Prau",
    location: "Dieng, Jawa Tengah",
    status: "Pantau info",
    statusClass: "status-watch",
    elevation: "2.590 mdpl",
  },
  {
    name: "Gunung Semeru",
    location: "Lumajang, Jawa Timur",
    status: "Tutup",
    statusClass: "status-closed",
    elevation: "3.676 mdpl",
  },
];

export default function Home() {
  return (
    <main>
      <header className="site-header">
        <Link className="brand" href="/" aria-label="Basecamp, halaman utama">
          <span className="brand-mark" aria-hidden="true">B</span>
          <span>basecamp<span className="brand-period">.</span></span>
        </Link>
        <nav className="main-nav" aria-label="Navigasi utama">
          <a href="#jalur">Jelajahi jalur</a>
          <a href="#tentang">Tentang kami</a>
        </nav>
        <Link className="button button-small button-outline" href="/login">
          Masuk
        </Link>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow"><span className="live-dot" /> TEMUKAN JALURMU</span>
          <h1>Gunung memanggil.<br /><span>Rencanakan langkahmu.</span></h1>
          <p>
            Informasi jalur, status gunung, dan persiapan pendakian dalam satu
            tempat. Mulai petualanganmu dengan lebih tenang.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href="#jalur">Jelajahi gunung <span aria-hidden="true">↗</span></a>
            <Link className="button button-text" href="/login">Lihat dashboard <span aria-hidden="true">→</span></Link>
          </div>
          <div className="hero-note">
            <span className="avatar-stack" aria-hidden="true"><i>R</i><i>A</i><i>D</i></span>
            <span>Teman perjalanan untuk pendaki Indonesia</span>
          </div>
        </div>
        <div className="hero-art" aria-label="Ilustrasi pegunungan">
          <div className="sun" />
          <div className="mountain-back" />
          <div className="mountain-mid" />
          <div className="mountain-front" />
          <div className="trail-card">
            <span className="trail-icon" aria-hidden="true">⌁</span>
            <span><strong>Setiap perjalanan</strong><small>dimulai dari persiapan</small></span>
          </div>
          <span className="art-caption">01° 09′ S&nbsp; 100° 21′ E</span>
        </div>
      </section>

      <section className="status-strip" aria-label="Informasi layanan">
        <div><span className="strip-icon">◎</span><span><strong>Info jalur terkini</strong><small>Ketahui kondisi sebelum berangkat</small></span></div>
        <div><span className="strip-icon">⌂</span><span><strong>Kelola pendakian</strong><small>Rencana dan dokumen dalam satu akun</small></span></div>
        <div><span className="strip-icon">↟</span><span><strong>Lebih siap mendaki</strong><small>Persiapan lebih baik, perjalanan lebih aman</small></span></div>
      </section>

      <section className="mountain-section" id="jalur">
        <div className="section-heading">
          <div>
            <span className="eyebrow">MULAI MENJELAJAH</span>
            <h2>Gunung pilihan</h2>
          </div>
          <span className="muted-copy">Contoh tampilan — data basecamp segera hadir</span>
        </div>
        <div className="mountain-grid">
          {mountains.map((mountain, index) => (
            <article className={`mountain-card mountain-card-${index + 1}`} key={mountain.name}>
              <div className="card-illustration" aria-hidden="true">
                <span className="card-sun" />
                <span className="card-peak" />
                <span className="card-hill" />
                <span className={`mountain-status ${mountain.statusClass}`}><i />{mountain.status}</span>
              </div>
              <div className="mountain-details">
                <div><h3>{mountain.name}</h3><p>{mountain.location}</p></div>
                <span className="elevation">{mountain.elevation}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="callout" id="tentang">
        <div>
          <span className="eyebrow">RUANG UNTUK SETIAP PETUALANG</span>
          <h2>Persiapan yang baik<br />membawa kita pulang.</h2>
          <p>Temukan informasi pendakian dan siapkan rencana perjalananmu.</p>
        </div>
        <Link className="button button-light" href="/login">Mulai sekarang <span aria-hidden="true">→</span></Link>
        <span className="callout-mark" aria-hidden="true">B</span>
      </section>

      <footer className="site-footer">
        <Link className="brand" href="/"><span className="brand-mark" aria-hidden="true">B</span><span>basecamp<span className="brand-period">.</span></span></Link>
        <span>Jelajah dengan persiapan. Pulang dengan cerita.</span>
        <span>© 2026 Basecamp</span>
      </footer>
    </main>
  );
}
