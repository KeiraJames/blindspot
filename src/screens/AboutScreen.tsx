import { SAFETY_TEXT } from '../components/SafetyNotice';
import { Screen } from '../components/Screen';
import { Card, LinkButton } from '../components/ui';

export default function AboutScreen() {
  return (
    <Screen title="Safety and help" back="/">
      <Card>
        <h2 className="text-xl font-bold mb-2">Safety</h2>
        <p>{SAFETY_TEXT}</p>
      </Card>
      <Card className="flex flex-col gap-2">
        <h2 className="text-xl font-bold">Devices</h2>
        <p>Scanning rooms needs an iPhone 12 Pro or later Pro model, or an iPad Pro with LiDAR.</p>
        <p>Navigating works on any iPhone or iPad with iOS 17, using maps someone else scanned.</p>
      </Card>
      <Card className="flex flex-col gap-2">
        <h2 className="text-xl font-bold">Privacy</h2>
        <p>The camera and LiDAR are processed on your device. Nothing is uploaded while you navigate.</p>
        <p>
          A room scan is uploaded only when you choose to save it to a shared map. Spoken directions are sent
          as text to our voice service; turn off the natural voice in Settings to keep speech fully on-device.
        </p>
      </Card>
      <Card className="flex flex-col gap-2">
        <h2 className="text-xl font-bold">How it works</h2>
        <ol className="list-decimal pl-6 flex flex-col gap-1">
          <li>A helper scans each room with a LiDAR iPhone. The app finds doors and stairs.</li>
          <li>In Map Studio, rooms are joined at their doors and floors are stacked.</li>
          <li>
            When you navigate, the route is worked out at that moment from the map, so new paths are used
            right away.
          </li>
        </ol>
      </Card>
      <LinkButton to="/practice" block>
        Practice gestures and vibrations
      </LinkButton>
    </Screen>
  );
}
