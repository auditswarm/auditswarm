import { Logo } from "@/components/Logo";
import {
  GitHubIcon,
  TwitterIcon,
  DiscordIcon,
  SolanaIcon,
  SocialLink,
} from "@/components/icons/SocialIcons";

const productLinks = [
  { href: "#", label: "How it Works" },
  { href: "#", label: "Features" },
  { href: "#", label: "Pricing" },
  { href: "#", label: "API" },
];

const resourceLinks = [
  { href: "#", label: "Documentation" },
  { href: "#", label: "GitHub" },
  { href: "#", label: "Blog" },
  { href: "#", label: "Support" },
];

const socialLinks = [
  {
    href: "https://github.com/auditswarm",
    icon: <GitHubIcon />,
    label: "GitHub",
  },
  {
    href: "https://twitter.com/auditswarm",
    icon: <TwitterIcon />,
    label: "Twitter",
  },
  {
    href: "https://discord.gg/auditswarm",
    icon: <DiscordIcon />,
    label: "Discord",
  },
];

function FooterLinkGroup({
  title,
  links,
}: {
  title: string;
  links: { href: string; label: string }[];
}) {
  return (
    <div>
      <h4 className="font-semibold text-white mb-4">{title}</h4>
      <ul className="space-y-3 text-sm">
        {links.map((link) => (
          <li key={link.label}>
            <a
              href={link.href}
              className="text-gray-500 hover:text-primary transition-colors"
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="relative pt-20 pb-8 px-6 overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 honeycomb-bg opacity-20" />
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-primary/5 rounded-full blur-[100px]" />

      <div className="max-w-7xl mx-auto relative z-10">
        {/* Main footer content */}
        <div className="grid md:grid-cols-4 gap-12 pb-12 border-b border-white/5">
          {/* Brand */}
          <div className="md:col-span-2">
            <div className="flex items-center gap-3 mb-4">
              <Logo size={32} className="text-primary" />
              <span className="font-display text-xl font-bold">AuditSwarm</span>
            </div>
            <p className="text-gray-500 text-sm leading-relaxed max-w-sm mb-6">
              AI-powered crypto tax compliance. Multi-jurisdiction reports with
              immutable on-chain attestations.
            </p>
            {/* Social links */}
            <div className="flex items-center gap-4">
              {socialLinks.map((link) => (
                <SocialLink key={link.label} {...link} />
              ))}
            </div>
          </div>

          <FooterLinkGroup title="Product" links={productLinks} />
          <FooterLinkGroup title="Resources" links={resourceLinks} />
        </div>

        {/* Bottom bar */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 pt-8">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>Built on</span>
            <SolanaIcon />
            <span className="text-[#14F195]">Solana</span>
          </div>

          <div className="font-mono text-xs text-gray-600">
            &copy; 2026 AuditSwarm. All rights reserved.
          </div>

          <div className="flex items-center gap-6 text-xs text-gray-600">
            <a href="#" className="hover:text-white transition-colors">
              Privacy
            </a>
            <a href="#" className="hover:text-white transition-colors">
              Terms
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
