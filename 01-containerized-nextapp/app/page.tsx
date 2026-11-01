import { connection } from "next/server";
import { Suspense } from "react";

type InformationCardProps = {
  label: string;
  value: string;
};

function InformationCard({ label, value }: InformationCardProps) {
  return (
    <div className="information-card">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function formatServerTime(date: Date) {
  return new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

async function StatusDetails() {
  await connection();

  const runtime = process.versions.bun ? "Bun" : "Node.js";
  const environment = process.env.APP_ENV ?? "Development";
  const version = process.env.APP_VERSION ?? "1.0.0";

  return (
    <>
      <section className="status-card" aria-label="Server status">
        <div className="status-indicator" aria-hidden="true" />
        <div>
          <p className="eyebrow">Server status</p>
          <p className="status-value">Online</p>
          <p className="status-description">
            Your homelab services are running normally.
          </p>
        </div>
      </section>

      <section className="details-section" aria-labelledby="details-heading">
        <div className="section-heading">
          <p className="eyebrow">System details</p>
          <h2 id="details-heading">Information</h2>
        </div>
        <dl className="information-grid">
          <InformationCard label="Environment" value={environment} />
          <InformationCard label="Application version" value={version} />
          <InformationCard
            label="Server time"
            value={formatServerTime(new Date())}
          />
          <InformationCard label="Runtime" value={runtime} />
        </dl>
      </section>
    </>
  );
}

function LoadingStatusDetails() {
  return <p className="loading-message">Loading server status...</p>;
}

export default function HomePage() {
  return (
    <main className="page-shell">
      <div className="dashboard">
        <header className="page-header">
          <p className="eyebrow">Homelab dashboard</p>
          <h1>Homelab Status</h1>
          <p className="page-description">
            A quick overview of your homelab environment and server health.
          </p>
        </header>

        <Suspense fallback={<LoadingStatusDetails />}>
          <StatusDetails />
        </Suspense>
      </div>
    </main>
  );
}
