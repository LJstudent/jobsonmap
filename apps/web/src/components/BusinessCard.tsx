import { Business } from '@/data/businesses';
import { MapPin } from 'lucide-react';
import { motion } from 'framer-motion';

interface BusinessCardProps {
  business: Business;
}

const BusinessCard = ({ business }: BusinessCardProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
      className="business-card"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="font-semibold text-foreground leading-tight">
          {business.name}
        </h3>
        <span className="hiring-badge whitespace-nowrap">
          Likely hiring
        </span>
      </div>
      
      <div className="flex items-center gap-1.5 text-muted-foreground mb-3">
        <MapPin className="w-3.5 h-3.5" />
        <span className="text-sm">
          {business.area}, {business.city}
        </span>
      </div>
      
      <p className="disclaimer-text">
        Based on public signals, not confirmed
      </p>
    </motion.div>
  );
};

export default BusinessCard;
