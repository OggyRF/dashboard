import { redirect } from "next/navigation";

// hidigital.co.in/team-login redirects to the app; this keeps the same path
// working on the app's own domain too.
export default function TeamLogin() {
  redirect("/login");
}
