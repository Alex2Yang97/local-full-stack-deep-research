import { Chat } from '@/components/chat';

export default function Home() {
  return (
    <main className="min-h-screen bg-background">
      <div className="container mx-auto py-4">
        <Chat />
      </div>
    </main>
  );
}
