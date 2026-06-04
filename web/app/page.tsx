import Link from 'next/link';
import Chat from '../components/Chat';

export default function Home() {
  return (
    <div className="flex flex-col h-screen">
      <header className="border-b border-slate-200 bg-white px-6 py-4 flex items-center gap-3 shrink-0">
        <span className="text-2xl">🪁</span>
        <div className="flex-1 min-w-0">
          <h1 className="font-bold text-slate-900 text-lg leading-tight">KiteScout</h1>
          <p className="text-xs text-slate-500">Find your perfect kite trip</p>
        </div>
        <Link href="/cruise"
          className="text-xs bg-sky-50 text-sky-700 border border-sky-200 rounded-full px-3 py-1.5 font-medium hover:bg-sky-100 transition-colors shrink-0">
          ⛵ Cruise Finder
        </Link>
      </header>
      <main className="flex-1 overflow-hidden">
        <Chat />
      </main>
    </div>
  );
}
