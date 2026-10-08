// Se remonta en cada navegación: reproduce la entrada suave de la vista (solo opacity/transform).
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
