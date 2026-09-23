import Link from "next/link";

export default function NotFound() {
  return (
    <main className="shell">
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Not found</h1>
          <p className="page-head__subtitle">There is no page at this address.</p>
        </div>
      </div>
      <p>
        <Link className="button" href="/">
          Back to the brief
        </Link>
      </p>
    </main>
  );
}
