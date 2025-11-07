import Image from 'next/image';

interface LogoProps {
  width?: number;
  height?: number;
  className?: string;
}

export function Logo({ width = 120, height = 140, className = '' }: LogoProps) {
  return (
    <div className={`flex items-center ${className}`}>
      <Image
        src="/logo.svg"
        alt="Maxillofaciális Rehabilitáció Logo"
        width={width}
        height={height}
        className="object-contain"
        priority
      />
    </div>
  );
}

