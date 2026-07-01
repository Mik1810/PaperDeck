import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f6f7fb] px-4 py-10">
      <section className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-lg bg-slate-950 text-sm font-black text-white shadow-sm">
            PD
          </div>
          <h1 className="mt-4 text-2xl font-black tracking-normal text-slate-950">
            Sign in to PaperDeck
          </h1>
          <p className="mt-2 text-sm font-medium leading-6 text-slate-600">
            Continue with Google to access your paper feed and private library.
          </p>
        </div>
        <div className="flex justify-center">
          <SignIn />
        </div>
      </section>
    </main>
  );
}
