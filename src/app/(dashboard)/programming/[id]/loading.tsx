export default function ProgrammingDetailLoading() {
  return (
    <div className="mx-auto w-full max-w-7xl animate-pulse space-y-6" aria-label="Cargando detalle de programación">
      <div className="h-24 rounded-2xl bg-muted" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="h-24 rounded-xl bg-muted" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
        <div className="space-y-6">
          <div className="h-64 rounded-2xl bg-muted" />
          <div className="h-72 rounded-2xl bg-muted" />
        </div>
        <div className="h-[32rem] rounded-2xl bg-muted" />
      </div>
    </div>
  );
}
