import ActivityImportForm from '../activity-import-form';

export default function ImportPage() {
  return (
    <main className="page-content">
      <header className="hero">
        <p className="eyebrow">ACTIVITY IMPORT</p>
        <h1>Every run<br />tells a <span>story.</span></h1>
        <p className="hero-copy">Import an activity to explore its effort, distance, and data coverage.</p>
      </header>
      <ActivityImportForm />
    </main>
  );
}
