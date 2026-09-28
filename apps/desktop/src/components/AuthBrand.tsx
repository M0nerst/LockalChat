interface AuthBrandProps {
  title?: string;
  subtitle?: string;
}

export function AuthBrand({ title = "LockalChat", subtitle }: AuthBrandProps) {
  return (
    <div className="auth-brand">
      <img src="/logo.png" alt="" className="auth-logo" width={72} height={72} />
      <h1>{title}</h1>
      {subtitle ? <p className="auth-subtitle">{subtitle}</p> : null}
    </div>
  );
}
