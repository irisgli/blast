import Link from "next/link";

export default function NotFound() {
  return (
    <main className="shell plain">
      <h1 className="title">Not found</h1>
      <p className="lede">There is no page at this address.</p>
      <p>
        <Link className="btn btn--primary" href="/">
          Back to the brief
        </Link>
      </p>
    </main>
  );
}
