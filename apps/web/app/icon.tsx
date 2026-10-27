import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

/**
 * The mark, as a favicon: a point and the rings it reaches, white on the brand blue, so
 * it reads on a light tab bar and a dark one alike. Rendered rather than checked in so it
 * is the same mark the page draws.
 */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#2a5bd7",
          borderRadius: 14,
        }}
      >
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
          <circle cx="8" cy="12" r="3.25" fill="#ffffff" />
          <path d="M13.5 7.5a6.4 6.4 0 0 1 0 9" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M17 4a11 11 0 0 1 0 16" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </div>
    ),
    size,
  );
}
