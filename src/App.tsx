import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Converter from "@/pages/converter";
import { Analytics } from "@vercel/analytics/react";

function App() {
  return (
    <TooltipProvider>
      <Toaster />
      <Converter />
      <Analytics />
    </TooltipProvider>
  );
}

export default App;
