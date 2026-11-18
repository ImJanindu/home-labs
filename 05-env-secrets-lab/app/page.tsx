export default function Home() {
  console.log(process.env.SECRET_SERVER_KEY);

  return (
    <main>
      <p>NEXT_PUBLIC_API_URL: {process.env.NEXT_PUBLIC_API_URL}</p>
    </main>
  );
}
