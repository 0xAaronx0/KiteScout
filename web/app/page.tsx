import Chat from '../components/Chat';

export default function Home() {
  return (
    <div className="flex flex-col h-screen">
      <header className="border-b border-slate-200 bg-white px-6 py-4 flex items-center gap-3 shrink-0">
        <span className="text-2xl">🪁</span>
        <div>
          <h1 className="font-bold text-slate-900 text-lg leading-tight">KiteScout</h1>
          <p className="text-xs text-slate-500">Find your perfect kite trip</p>
        </div>
      </header>
      <main className="flex-1 overflow-hidden">
        <Chat />
      </main>
    </div>
  );
}
