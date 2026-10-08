import { getHomeStamp } from "../../lib/stamp";

export const dynamic = "force-dynamic";

export default async function StampPage() {
  const { title, stamp } = await getHomeStamp();
  // One string, so React does not split it with comment markers.
  return <p id="stamp">{`${title}:stamp:${stamp}`}</p>;
}
