export function Brand() {
  const build = import.meta.env.VITE_BUILD_SHA ?? "development";
  return (
    <div className="brand">
      <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
        <path
          d="M16 2 20 12 30 16 20 20 16 30 12 20 2 16 12 12Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path d="M16 7 18 14 25 16 18 18 16 25 14 18 7 16 14 14Z" fill="currentColor" />
      </svg>
      <span>
        Vellum <i>&</i> Vector
      </span>
      <small
        className="build-version"
        aria-label="Application build"
        title={`Application build ${build}`}
      >
        Build {build.slice(0, 7)}
      </small>
    </div>
  );
}
