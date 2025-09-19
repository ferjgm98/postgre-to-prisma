import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Converter from "@/pages/converter";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";

function App() {
  return (
    <TooltipProvider>
      <Toaster />
      <Converter />
      <Analytics />
      <SpeedInsights />
    </TooltipProvider>
  );
}

export default App;
