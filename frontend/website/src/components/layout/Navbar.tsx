import { Logo } from "@/components/Logo";
import { GitHubIcon } from "@/components/icons/SocialIcons";

const navLinks = [
  { href: "#", label: "Home", active: true },
  { href: "#process", label: "Process" },
  { href: "#features", label: "Features" },
  { href: "#security", label: "Security" },
  { href: "#", label: "Docs" },
];

export function Navbar() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 py-4 px-6">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex-1">
          <Logo size={32} className="text-primary" />
        </div>

        <div className="hidden md:flex items-center gap-1 px-2 py-1.5 rounded-full bg-surface/80 backdrop-blur-lg border border-white/10">
          {navLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className={`px-4 py-1.5 text-sm transition-colors ${
                link.active
                  ? "text-white hover:text-primary"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {link.label}
            </a>
          ))}
          <div className="w-px h-5 bg-white/10 mx-1" />
          <a
            href="https://github.com/auditswarm"
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 text-gray-400 hover:text-white transition-colors"
          >
            <GitHubIcon className="w-4 h-4" />
          </a>
        </div>

        <div className="flex-1 flex justify-end">
          <button className="px-5 py-2 bg-primary text-background text-sm font-semibold rounded-full hover:bg-primary-400 transition-all">
            Launch App
          </button>
        </div>
      </div>
    </nav>
  );
}
