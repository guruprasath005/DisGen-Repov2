import { Ionicons } from "@expo/vector-icons"
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs"
import * as React from "react"

import { useAuth } from "../contexts/AuthContext"
import { useTheme } from "../contexts/ThemeContext"
import { AdminScreen } from "../screens/AdminScreen"
import { DashboardScreen } from "../screens/DashboardScreen"
import { DocumentsScreen } from "../screens/DocumentsScreen"
import { ProfileScreen } from "../screens/ProfileScreen"
import { UploadScreen } from "../screens/UploadScreen"
import { GlassTabBar } from "./GlassTabBar"
import type { MainTabParamList } from "./types"

const Tab = createBottomTabNavigator<MainTabParamList>()

export function MainTabsNavigator() {
  const { user } = useAuth()
  const { theme } = useTheme()
  const hideUpload =
    user?.role === "admin" || user?.role === "super_admin"

  return (
    <Tab.Navigator
      tabBar={(props) => <GlassTabBar {...props} />}
      screenOptions={{
        sceneStyle: { backgroundColor: "transparent" },
        headerShown: false,
        tabBarActiveTintColor: theme.orange,
        tabBarInactiveTintColor: theme.muted,
        tabBarHideOnKeyboard: true,
        tabBarShowLabel: true,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
          letterSpacing: 0.2,
          marginBottom: 2,
        },
        tabBarIconStyle: {
          marginTop: 4,
        },
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          tabBarIcon: ({ focused, color }) => (
            <Ionicons
              name={focused ? "home" : "home-outline"}
              color={color}
              size={focused ? 24 : 22}
            />
          ),
        }}
      />
      <Tab.Screen
        name="Documents"
        component={DocumentsScreen}
        options={{
          tabBarIcon: ({ focused, color }) => (
            <Ionicons
              name={focused ? "document-text" : "document-text-outline"}
              color={color}
              size={focused ? 24 : 22}
            />
          ),
        }}
      />
      {!hideUpload ? (
        <Tab.Screen
          name="Upload"
          component={UploadScreen}
          options={{
            tabBarIcon: ({ focused, color }) => (
              <Ionicons
                name={focused ? "cloud-upload" : "cloud-upload-outline"}
                color={color}
                size={focused ? 24 : 22}
              />
            ),
          }}
        />
      ) : (
        <Tab.Screen
          name="Admin"
          component={AdminScreen}
          options={{
            tabBarIcon: ({ focused, color }) => (
              <Ionicons
                name={
                  focused ? "shield-checkmark" : "shield-checkmark-outline"
                }
                color={color}
                size={focused ? 24 : 22}
              />
            ),
          }}
        />
      )}
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarIcon: ({ focused, color }) => (
            <Ionicons
              name={focused ? "person" : "person-outline"}
              color={color}
              size={focused ? 24 : 22}
            />
          ),
        }}
      />
    </Tab.Navigator>
  )
}
