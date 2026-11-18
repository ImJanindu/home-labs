import { Suspense } from 'react';
import { headers } from 'next/headers';

// 1. This component is dynamic because it reads headers()
async function ServerSecretLogger() {
  await headers();
  console.log("Runtime EC2 Secret:", process.env.SECRET_SERVER_KEY);
  return null; // It renders nothing to the screen
}

export default function Home() {
  return (
    <main>
      <p>NEXT_PUBLIC_API_URL: {process.env.NEXT_PUBLIC_API_URL}</p>
      
      {/* 2. Suspense tells the builder: "Skip compiling this during the Docker build, execute it at runtime" */}
      <Suspense fallback={null}>
        <ServerSecretLogger />
      </Suspense>
    </main>
  );
}