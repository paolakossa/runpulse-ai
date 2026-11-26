import ActivityImportForm from './activity-import-form';

export default function Home() {
  return (
    <main className="page-shell">
      <header className="brand">
        <span className="brand-mark" aria-hidden="true">R</span>
        <span>RUNPULSE <span className="brand-divider">/</span> AI</span>
      </header>
      <div className="hero">
        <p className="eyebrow">RUNNING, WITH CONTEXT</p>
        <h1>Every run<br />tells a <span>story.</span></h1>
        <p className="hero-copy">Import an activity to explore your effort, distance, and data coverage.</p>
      </div>
      <ActivityImportForm />
      <footer>Built for thoughtful training. Metrics are descriptive, not medical advice.</footer>
    </main>
  );
}
