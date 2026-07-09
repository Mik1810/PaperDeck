import Image from "next/image";
import { SignUp } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { isDevAuthEnabled } from "@/lib/auth/dev-auth";

export default function SignUpPage() {
  if (isDevAuthEnabled()) {
    redirect("/feed");
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#f6f7fb] px-4 py-10">
      <section className="w-full max-w-md">
        <div className="mb-6 text-center">
          <Image
            alt="PaperDeck"
            className="mx-auto h-12 w-12 rounded-lg shadow-sm"
            height={48}
            priority
            src="/icon.svg"
            width={48}
          />
          <h1 className="mt-4 text-2xl font-black tracking-normal text-slate-950">
            Create your PaperDeck account
          </h1>
          <p className="mt-2 text-sm font-medium leading-6 text-slate-600">
            Start with Google, then tune your computer science interests.
          </p>
        </div>
        <div className="flex justify-center">
          <SignUp />
        </div>
      </section>
    </main>
  );
}
