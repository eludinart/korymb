import React from "react";
import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Home from "./components/Home";
//import Manual from "./components/Manual";
import Manual from "./components/ManualPages";
import CardList from "./components/CardList";
import CardDetail from "./components/CardDetail";
import Draw from "./components/Draw";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/manuel" element={<Manual />} />
        <Route path="/cartes" element={<CardList />} />
        <Route path="/cartes/:id" element={<CardDetail />} />
        <Route path="/tirage" element={<Draw />} />
      </Routes>
    </Layout>
  );
}
