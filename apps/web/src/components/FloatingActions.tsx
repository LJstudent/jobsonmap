import { Github, Heart, Minus, Plus } from 'lucide-react';
import { motion } from 'framer-motion';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface FloatingActionsProps {
  onZoomIn?: () => void;
  onZoomOut?: () => void;
}

const FloatingActions = ({ onZoomIn, onZoomOut }: FloatingActionsProps) => {
  const isZoomDisabled = !onZoomIn || !onZoomOut;

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, delay: 0.3 }}
      className="fixed bottom-24 right-4 z-[1000] flex flex-col gap-3"
    >
      <div className="flex flex-col gap-2">
        <button
          type="button"
          className="floating-button text-foreground hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Zoom in"
          onClick={onZoomIn}
        >
          <Plus className="w-5 h-5" />
        </button>
        <button
          type="button"
          className="floating-button text-foreground hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Zoom out"
          onClick={onZoomOut}
        >
          <Minus className="w-5 h-5" />
        </button>
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="floating-button text-github hover:text-primary"
          >
            <Github className="w-5 h-5" />
          </a>
        </TooltipTrigger>
        <TooltipContent side="left" className="bg-card border-border">
          <p>Contribute on GitHub</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href="#donate"
            className="floating-button text-donate hover:text-donate"
          >
            <Heart className="w-5 h-5" />
          </a>
        </TooltipTrigger>
        <TooltipContent side="left" className="bg-card border-border">
          <p>Support this project</p>
        </TooltipContent>
      </Tooltip>
    </motion.div>
  );
};

export default FloatingActions;
