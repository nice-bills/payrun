import { redirect } from "next/navigation";

// The landing page comes after the desk; until then the root opens the desk.
export default function Home() {
  redirect("/desk");
}
