

"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/auth-context';
import { Role } from '@/lib/types';
import { cn, formatUserName } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LogOut, Shield, Truck, LayoutDashboard, User, Briefcase, ChevronDown, Wrench, Sprout, FileWarning } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';


const NavLink = ({ href, children }: { href: string; children: React.ReactNode }) => {
    const pathname = usePathname();
    const isActive = pathname === href;

    return (
        <Link href={href} passHref>
            <Button variant={isActive ? "secondary" : "ghost"}>
                {children}
            </Button>
        </Link>
    )
}

export function MainHeader() {
  const { user, firebaseUser, logout, hasRole, loading } = useAuth();
  const isMobile = useIsMobile();
  const pathname = usePathname();
  if (pathname.startsWith('/office') || pathname === '/driver') return null;
  if (loading || !user) {
    return (
        <header className="flex h-16 shrink-0 items-center border-b bg-card px-6 shadow-sm">
            <div className='flex items-center gap-2'>
                <Truck className="h-6 w-6 text-primary" />
                <h1 className="text-xl md:text-2xl font-bold tracking-tight text-foreground">
                    تكسي نابلس والمهندس
                </h1>
            </div>
        </header>
    );
  }

  const canAccessDispatch = hasRole(Role.DISPATCHER);
  const canAccessDriver = hasRole(Role.DRIVER);
  const canAccessAdmin = hasRole(Role.ADMIN) || hasRole(Role.OWNER) || hasRole(Role.SUPER_ADMIN);
  const canAccessSuperAdmin = hasRole(Role.SUPER_ADMIN);
  
  const isAdminPath = pathname.startsWith('/admin');

  return (
    <header className="flex h-16 shrink-0 items-center border-b bg-card px-4 md:px-6 shadow-sm">
        <div className='flex items-center gap-2'>
            <Link href="/" className="flex items-center gap-2 mr-4">
                <Truck className="h-6 w-6 text-primary" />
                <h1 className="hidden sm:block text-xl md:text-2xl font-bold tracking-tight text-foreground">
                    تكسي نابلس والمهندس
                </h1>
            </Link>
        </div>

        <nav className='hidden md:flex items-center gap-2'>
            {canAccessDispatch && <NavLink href="/"><LayoutDashboard className="mr-2"/> Dispatch</NavLink>}
            {canAccessDriver && <NavLink href="/driver"><Truck className="mr-2" /> Driver View</NavLink>}
            {canAccessAdmin && (
                 <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant={isAdminPath ? "secondary" : "ghost"}>
                            <Shield className="mr-2"/> Admin <ChevronDown className="ml-1 h-4 w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                        <DropdownMenuItem asChild>
                            <Link href="/admin">
                                <LayoutDashboard className="mr-2" /> User Management
                            </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                            <Link href="/admin/vehicles">
                                <Truck className="mr-2" /> Manage Vehicles
                            </Link>
                        </DropdownMenuItem>
                         <DropdownMenuItem asChild>
                            <Link href="/admin/shifts">
                                <Briefcase className="mr-2" /> Manage Shifts
                            </Link>
                        </DropdownMenuItem>
                         <DropdownMenuItem asChild>
                            <Link href="/admin/maintenance">
                                <Wrench className="mr-2" /> Manage Maintenance
                            </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                            <Link href="/admin/auditing">
                                <FileWarning className="mr-2" /> Auditing
                            </Link>
                        </DropdownMenuItem>
                        {canAccessSuperAdmin && (
                            <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem asChild>
                                    <Link href="/admin/superadmin">
                                        <Sprout className="mr-2" /> Super Admin
                                    </Link>
                                </DropdownMenuItem>
                            </>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            )}
        </nav>
        
        <div className="ml-auto flex items-center gap-3">
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="relative h-10 w-10 rounded-full">
                        <Avatar>
                            <AvatarImage src={user.photoURL ?? firebaseUser?.photoURL ?? undefined} />
                            <AvatarFallback>{(user.displayName || user.email || 'U')[0]}</AvatarFallback>
                        </Avatar>
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="end" forceMount>
                    <DropdownMenuLabel className="font-normal">
                        <div className="flex flex-col space-y-1">
                            <p className="text-sm font-medium leading-none">{formatUserName(user.displayName, user.email)}</p>
                            <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
                        </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {isMobile && (
                        <>
                         {canAccessDispatch && <DropdownMenuItem asChild><Link href="/"><LayoutDashboard className="mr-2"/> Dispatch</Link></DropdownMenuItem>}
                         {canAccessDriver && <DropdownMenuItem asChild><Link href="/driver"><Truck className="mr-2"/> Driver View</Link></DropdownMenuItem>}
                         {canAccessAdmin && <DropdownMenuItem asChild><Link href="/admin"><Shield className="mr-2"/> Admin</Link></DropdownMenuItem>}
                         <DropdownMenuSeparator />
                        </>
                    )}
                    <DropdownMenuItem asChild>
                       <Link href="/settings"><User className="mr-2"/> Settings</Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => logout()}>
                        <LogOut className="mr-2"/>
                        Log out
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    </header>
  );
}
