import { motion } from 'framer-motion';

const Footer = () => {
  return (
    <motion.footer
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4, delay: 0.4 }}
      className="fixed bottom-0 left-0 right-0 z-[1000] py-3 text-center bg-background/80 backdrop-blur-sm border-t border-border"
    >
      <p className="text-sm text-muted-foreground">
        Open-source experiment • No tracking • No login
      </p>
    </motion.footer>
  );
};

export default Footer;
