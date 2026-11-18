import { headers } from 'next/headers';

export default async function Home() {
  // Calling headers() automatically forces this page to render dynamically at runtime
  await headers(); 

  console.log("Runtime EC2 Secret:", process.env.SECRET_SERVER_KEY);

  return (
    <main>
      <p>NEXT_PUBLIC_API_URL: {process.env.NEXT_PUBLIC_API_URL}</p>
    </main>
  );
}