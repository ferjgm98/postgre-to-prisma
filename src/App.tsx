import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Converter from "@/pages/converter";

function App() {
  return (
    <TooltipProvider>
      <Toaster />
      <Converter />
    </TooltipProvider>
  );
}

export default App;
