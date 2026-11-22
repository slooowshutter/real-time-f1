import { notFound } from "next/navigation";
import { Race } from "./dashboard";

export default async function Layout({ children, params }: LayoutProps<"/[session]">) {
  const sk = Number((await params).session);
  if (!Number.isInteger(sk) || sk <= 0) notFound();
  return (
    <Race key={sk} sk={sk}>
      {children}
    </Race>
  );
}
