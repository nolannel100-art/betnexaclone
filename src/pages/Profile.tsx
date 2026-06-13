import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Header } from "@/components/Header";
import { BottomNav } from "@/components/BottomNav";
import { Footer } from "@/components/Footer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  User,
  Mail,
  Phone,
  Award,
  Settings,
  LogOut,
  Edit2,
  CheckCircle,
  Wallet,
  Download,
  Copy,
  Hash,
  FileText,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useUser } from "@/context/UserContext";
import { useBets } from "@/context/BetContext";
import betnexaAPK from "@/assets/betnexa apk.apk";

export default function Profile() {
  const navigate = useNavigate();
  const { user, updateUser, logout } = useUser();
  const { balance } = useBets();
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState(user);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadNotification, setDownloadNotification] = useState(false);

  const handleSave = () => {
    updateUser(editData);
    setIsEditing(false);
  };

  const handleDownloadAPK = async () => {
    try {
      setIsDownloading(true);
      setDownloadNotification(true);

      // Create a temporary link to download the APK
      const link = document.createElement("a");
      link.href = betnexaAPK;
      link.download = "betnexa.apk";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Hide notification after the download starts
      setTimeout(() => {
        setDownloadNotification(false);
      }, 3000);

      setIsDownloading(false);
    } catch (error) {
      console.error("Error downloading APK:", error);
      setIsDownloading(false);
      alert("Error downloading APK. Please try again.");
    }
  };

  const stats = [
    { label: "Total Bets", value: user?.totalBets?.toString() || "0", icon: Award },
    { label: "Member Since", value: "1 Year 8 Months", icon: Phone },
    {
      label: "Verification",
      value: "Verified",
      icon: CheckCircle,
      color: "text-green-500",
    },
  ];

  return (
    <div className="min-h-screen bg-background pb-24">
      <Header />

      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="font-display text-3xl font-bold uppercase tracking-wider text-foreground">
            Profile
          </h1>
          <p className="mt-2 text-muted-foreground">
            Manage your account settings
          </p>
        </div>

        {/* Profile Header */}
        <Card className="mb-8 border-primary/30 bg-card p-6">
          <div className="flex flex-col items-start justify-between md:flex-row md:items-center">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/20">
                <User className="h-8 w-8 text-primary" />
              </div>
              <div>
                <p className="font-display text-2xl font-bold text-foreground">
                  {user?.name}
                </p>
                <p className="text-muted-foreground">@{user?.username}</p>
                <Badge className="mt-2 bg-gold/20 text-gold">
                  {user?.level}
                </Badge>
              </div>
            </div>
            <Button
              variant={isEditing ? "ghost" : "hero"}
              size="sm"
              onClick={() => {
                if (isEditing) {
                  handleSave();
                } else {
                  setIsEditing(true);
                }
              }}
            >
              <Edit2 className="mr-2 h-4 w-4" />
              {isEditing ? "Save Changes" : "Edit Profile"}
            </Button>
          </div>
        </Card>

        {/* BETNEXA Account Number Card */}
        {user?.betnexaId && (
          <Card className="mb-8 border-primary/30 bg-card p-6 neon-border">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Hash className="h-5 w-5 text-primary" />
                  <p className="text-sm font-medium text-muted-foreground">Your BETNEXA Account Number</p>
                </div>
                <p className="text-3xl font-bold font-mono tracking-widest text-primary">
                  {user.betnexaId}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Use this as your Account Number when depositing via M-Pesa Paybill <span className="font-bold text-foreground">4320291</span>
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="border-primary/30 text-primary"
                onClick={() => {
                  navigator.clipboard.writeText(user.betnexaId || '');
                  alert('Account number copied!');
                }}
              >
                <Copy className="mr-2 h-4 w-4" /> Copy
              </Button>
            </div>
          </Card>
        )}

        <Tabs defaultValue="account">
          <TabsList className="grid w-full grid-cols-1">
            <TabsTrigger value="account">Account</TabsTrigger>
          </TabsList>

          <TabsContent value="account" className="space-y-6">
            {/* Personal Information */}
            <Card className="border-border bg-card p-6">
              <h3 className="mb-4 font-display text-lg font-bold uppercase text-foreground">
                Personal Information
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="flex items-center text-sm font-medium text-foreground">
                    <User className="mr-2 h-4 w-4" /> Full Name
                  </label>
                  {isEditing ? (
                    <Input
                      value={editData.name}
                      onChange={(e) =>
                        setEditData({ ...editData, name: e.target.value })
                      }
                      className="mt-2"
                    />
                  ) : (
                    <p className="mt-2 text-foreground">{user?.name}</p>
                  )}
                </div>

                <div>
                  <label className="flex items-center text-sm font-medium text-foreground">
                    <Mail className="mr-2 h-4 w-4" /> Email
                  </label>
                  {isEditing ? (
                    <Input
                      type="email"
                      value={editData.email}
                      onChange={(e) =>
                        setEditData({ ...editData, email: e.target.value })
                      }
                      className="mt-2"
                    />
                  ) : (
                    <p className="mt-2 text-foreground">{user?.email}</p>
                  )}
                </div>

                <div>
                  <label className="flex items-center text-sm font-medium text-foreground">
                    <Phone className="mr-2 h-4 w-4" /> Phone Number
                  </label>
                  {isEditing ? (
                    <Input
                      value={editData.phone}
                      disabled
                      className="mt-2 opacity-60 cursor-not-allowed"
                      title="Phone number cannot be changed"
                    />
                  ) : (
                    <p className="mt-2 text-foreground">{user?.phone}</p>
                  )}
                  {isEditing && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Phone number cannot be changed after verification
                    </p>
                  )}
                </div>
              </div>
            </Card>

            {/* Account Stats */}
            <Card className="border-border bg-card p-6">
              <h3 className="mb-4 font-display text-lg font-bold uppercase text-foreground">
                Account Statistics
              </h3>
              <div className="grid gap-4 md:grid-cols-4">
                <div>
                  <p className="text-sm text-muted-foreground">Account Balance</p>
                  <p className="mt-2 text-2xl font-bold text-gold">
                    KSH {balance.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Bets</p>
                  <p className="mt-2 text-2xl font-bold text-primary">
                    {user?.totalBets || 0}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Earnings</p>
                  <p className="mt-2 text-2xl font-bold text-green-500">
                    KSH {(user?.totalWinnings || 0).toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Member Since</p>
                  <p className="mt-2 text-2xl font-bold text-foreground">
                    {user?.joinDate || "N/A"}
                  </p>
                </div>
              </div>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Logout and Download Button */}
        <div className="mt-8 space-y-3">
          <Button
            variant="outline"
            className="w-full text-primary border-primary hover:bg-primary/10"
            onClick={handleDownloadAPK}
            disabled={isDownloading}
          >
            <Download className="mr-2 h-4 w-4" />
            {isDownloading ? "Downloading APK..." : "Download Mobile App (APK)"}
          </Button>
          <Button
            variant="outline"
            className="w-full text-primary border-primary hover:bg-primary/10"
            onClick={() => navigate("/terms")}
          >
            <FileText className="mr-2 h-4 w-4" /> Terms & Conditions
          </Button>
          <Button
            variant="ghost"
            className="w-full text-red-500 hover:bg-red-500/10"
            onClick={logout}
          >
            <LogOut className="mr-2 h-4 w-4" /> Logout
          </Button>
        </div>

        {/* Download Notification Toast */}
        {downloadNotification && (
          <div className="fixed bottom-24 left-4 right-4 bg-primary text-primary-foreground rounded-lg px-4 py-3 shadow-lg flex items-center gap-2 z-50 animate-fade-up">
            <Download className="h-4 w-4 animate-pulse" />
            <span className="text-sm font-medium">Download in progress... Please wait</span>
          </div>
        )}
      </div>

      <Footer />
      <BottomNav />
    </div>
  );
}
